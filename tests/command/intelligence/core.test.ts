import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntelligenceStore, contentHashOf } from '../../../src/command/intelligence/store.js';
import { buildDecisionCase, classifyInbound, decisionKindOf, REQUIRED_INFO_MAP } from '../../../src/command/intelligence/classify.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-intel-'));

describe('DIOS中核データモデル（§2）', () => {
  it('RawEventはexternalId+revision+hashで冪等（同一入力から重複を作らない）', () => {
    const s = new IntelligenceStore(tmp());
    const input = { companyId: 'lcc', source: 'gmail' as const, externalId: 'msg-1', content: { subject: '入金の件', body: 'テスト' } };
    const r1 = s.ingestRawEvent(input);
    const r2 = s.ingestRawEvent(input);
    expect(r1.deduplicated).toBe(false);
    expect(r2.deduplicated).toBe(true);
    expect(r2.event.rawEventId).toBe(r1.event.rawEventId);
    // revision違いは新規
    const r3 = s.ingestRawEvent({ ...input, revision: 2, content: { subject: '入金の件', body: '訂正版' } });
    expect(r3.deduplicated).toBe(false);
    // 別externalIdでも同一contentはhashで重複排除
    const r4 = s.ingestRawEvent({ ...input, externalId: 'msg-1-copy' });
    expect(r4.deduplicated).toBe(true);
    expect(s.rawEvents()).toHaveLength(2);
  });

  it('訂正はsupersededByで接続し、旧版を削除せず履歴確認できる（§12-5前提）', () => {
    const s = new IntelligenceStore(tmp());
    const f1 = s.addFact({
      companyId: 'lcc', kind: 'FACT', statement: '山田邸の外構は9月開始',
      entities: [{ entityType: 'project', entityId: 'p1', name: '山田邸' }],
      evidence: [], approvalState: 'AUTO', sourceRawEventIds: []
    });
    const f2 = s.correctFact(f1.factId, {
      companyId: 'lcc', statement: '山田邸の外構は10月開始（9月は誤り）',
      entities: [{ entityType: 'project', entityId: 'p1', name: '山田邸' }],
      evidence: [], approvalState: 'CANDIDATE', sourceRawEventIds: []
    });
    expect(f2).not.toBeNull();
    const current = s.currentFacts();
    expect(current.some((f) => f.statement.includes('10月開始'))).toBe(true);
    expect(current.some((f) => f.factId === f1.factId)).toBe(false); // 旧版は現行から除外
    const all = s.allFactsIncludingSuperseded();
    const old = all.find((f) => f.factId === f1.factId);
    expect(old?.supersededBy).toBe(f2!.factId); // ただし履歴として保持
  });

  it('再起動（新インスタンス）後も全レコードが復元される（§12-8）', () => {
    const dir = tmp();
    const s = new IntelligenceStore(dir);
    s.ingestRawEvent({ companyId: 'lcc', source: 'lineworks', externalId: 'ev-1', content: { text: '現場A' } });
    const c = s.addCase(buildDecisionCase({
      raw: s.rawEvents()[0], text: '未入金の確認をお願いします', entities: [],
      confirmedFacts: ['請求金額と入金予定日（Source of Truth）: 850万円/8/10'], aiHypotheses: [], evidence: []
    }));
    const a = s.addAction({
      companyId: 'lcc', title: '入金状況の確認', owner: 'AI', ownerName: 'LCC COMMAND',
      status: 'WAITING_EXTERNAL', dueAt: null, completionCriteria: '入金確認', entities: [],
      relatedCaseId: c.caseId, watchKey: 'gmail:thread-9', sourceRawEventIds: []
    });
    s.addAgentRun({ companyId: 'lcc', capability: 'RESEARCH', provider: 'anthropic', inputSummary: 'x', resultSummary: '', status: 'QUEUED', costNote: null, durationMs: null, startedAt: new Date().toISOString(), finishedAt: null, relatedCaseId: c.caseId, resultTrust: 'HYPOTHESIS' });
    s.addOutcome({ companyId: 'lcc', relatedCaseId: c.caseId, predicted: '3日以内入金', actual: '5日後入金', gapAnalysis: null });
    // E2E-11: 訂正履歴（superseded）も再起動後に保持される
    const f1 = s.addFact({ companyId: 'lcc', kind: 'FACT', statement: '入金予定は8/10', entities: [], evidence: [], approvalState: 'CANDIDATE', sourceRawEventIds: [] });
    s.correctFact(f1.factId, { companyId: 'lcc', statement: '入金予定は8/20（8/10は誤り）', entities: [], evidence: [], approvalState: 'CANDIDATE', sourceRawEventIds: [] });
    const s2 = new IntelligenceStore(dir);
    expect(s2.rawEvents()).toHaveLength(1);
    expect(s2.cases()).toHaveLength(1);
    expect(s2.actions()[0].actionId).toBe(a.actionId);
    expect(s2.agentRuns()).toHaveLength(1);
    expect(s2.outcomes()).toHaveLength(1);
    expect(s2.currentFacts().some((f) => f.statement.includes('8/20'))).toBe(true);
    expect(s2.allFactsIncludingSuperseded().find((f) => f.factId === f1.factId)?.supersededBy).toBeTruthy(); // 訂正履歴保持
  });

  it('返信待ちはwatchKey一致の新着で自動再開する（§8）', () => {
    const s = new IntelligenceStore(tmp());
    s.addAction({ companyId: 'lcc', title: '返信待ち', owner: 'AI', ownerName: 'LCC COMMAND', status: 'WAITING_EXTERNAL', dueAt: null, completionCriteria: 'x', entities: [], relatedCaseId: null, watchKey: 'gmail:thread-1', sourceRawEventIds: [] });
    const resumed = s.resumeWaitingByWatchKey('gmail:thread-1');
    expect(resumed).toHaveLength(1);
    expect(s.actions()[0].status).toBe('GATHERING_INFORMATION');
  });

  it('改善提案は承認前に適用されず、承認後のみRuleVersion更新。同一Proposalの二重承認は拒否（E2E-8/9）', () => {
    const s = new IntelligenceStore(tmp());
    const p = s.addProposal({ companyId: 'lcc', title: '入金確認は3営業日で自動再確認', rationale: 'Outcome差分', metric: '回収日数', risk: '過剰連絡', relatedOutcomeIds: [] });
    expect(s.currentRule('rule-collection')).toBeNull(); // 承認前は未適用
    expect(() => s.approveProposal(p.proposalId, '', { ruleId: 'rule-collection', name: '回収ルール', body: 'v1', rollbackNote: '旧版へ戻す', companyId: 'lcc' })).toThrow();
    const rv = s.approveProposal(p.proposalId, '坂本社長', { ruleId: 'rule-collection', name: '回収ルール', body: '3営業日で再確認', rollbackNote: 'previousBodyへ戻す', companyId: 'lcc' });
    expect(rv.currentVersion).toBe(1);
    expect(rv.approvedBy).toBe('坂本社長');
    // E2E-9: 同じProposalの二重承認は拒否（Ruleも増えない）
    expect(() => s.approveProposal(p.proposalId, '坂本社長', { ruleId: 'rule-collection', name: '回収ルール', body: '2営業日で再確認', rollbackNote: 'previousBodyへ戻す', companyId: 'lcc' })).toThrow(/二重承認/);
    expect(s.currentRule('rule-collection')!.currentVersion).toBe(1);
    // 別Proposalの承認で版数が上がり、旧版が保持される
    const p2 = s.addProposal({ companyId: 'lcc', title: '再確認を2営業日へ', rationale: '差分', metric: '回収日数', risk: '過剰連絡', relatedOutcomeIds: [] });
    const rv2 = s.approveProposal(p2.proposalId, '坂本社長', { ruleId: 'rule-collection', name: '回収ルール', body: '2営業日で再確認', rollbackNote: 'previousBodyへ戻す', companyId: 'lcc' });
    expect(rv2.currentVersion).toBe(2);
    expect(rv2.previousBody).toBe('3営業日で再確認');
  });
});

describe('DIOS分類とDecisionCase（§3）', () => {
  it('新着を無条件タスク化せず5分類する（除外は理由付き）', () => {
    expect(classifyInbound('本日の作業完了しました').kind).toBe('INFORMATION');
    expect(classifyInbound('見積の作成をお願いします').kind).toBe('ACTION_REQUIRED');
    expect(classifyInbound('先月分が未入金です。至急確認を').kind).toBe('PRESIDENT_DECISION');
    // AWAITING_REPLYは相手が「後で回答する」と明言した場合のみ（こちらが待つ側）
    expect(classifyInbound('社内で確認してご連絡します').kind).toBe('AWAITING_REPLY');
    expect(classifyInbound('担当が確認中とのことです').kind).toBe('AWAITING_REPLY');
    const ex = classifyInbound('夏の特別キャンペーンのご案内');
    expect(ex.kind).toBe('EXCLUDED');
    if (ex.kind === 'EXCLUDED') expect(ex.reason).toContain('広告');
  });

  it('E2E-3: 「ご返信お願いします」「ご返信ください」は相手がこちらの返信を求めている＝ACTION_REQUIRED（§D）', () => {
    expect(classifyInbound('お手数ですがご返信お願いします').kind).toBe('ACTION_REQUIRED');
    expect(classifyInbound('内容をご確認のうえご返信ください').kind).toBe('ACTION_REQUIRED');
    expect(classifyInbound('回答をお待ちしております').kind).toBe('ACTION_REQUIRED');
    expect(classifyInbound('お返事いただけますと幸いです').kind).toBe('ACTION_REQUIRED');
  });

  it('DecisionCaseは必須項目を全て持ち、必要情報マップから不足を出す（4種）', () => {
    const s = new IntelligenceStore(tmp());
    const { event } = s.ingestRawEvent({ companyId: 'lcc', source: 'gmail', externalId: 'm1', content: { body: '事故' } });
    for (const [text, kind] of [['現場でケガ人が出ました', '事故・クレーム'], ['未入金の件', '入金・回収'], ['値引の相談', '見積・受注'], ['明日の配置に欠員', '配置・日報']] as const) {
      expect(decisionKindOf(text)).toBe(kind);
      const c = buildDecisionCase({ raw: event, text, entities: [], confirmedFacts: [], aiHypotheses: ['推測1'], evidence: [] });
      expect(c.missingInformation.length).toBe(REQUIRED_INFO_MAP[kind].length);
      expect(c.options.length).toBeGreaterThanOrEqual(2);
      expect(c.aiRecommendation.length).toBeGreaterThan(5);
      expect(c.recommendationReason).toContain('AI推測1件は根拠に含めていません');
      expect(c.riskIfWrong.length).toBeGreaterThan(3);
      expect(c.presidentNextAction.length).toBeGreaterThan(3);
      expect(c.completionCriteria).toContain('完了条件');
    }
  });

  it('canonical hashはキー順に依存しない', () => {
    expect(contentHashOf({ a: 1, b: 2 })).toBe(contentHashOf({ b: 2, a: 1 }));
  });
});
