import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeFromOutcomes, recordOutcome, topPendingProposal } from '../../../src/command/intelligence/growthLoop.js';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import { buildDecisionCase } from '../../../src/command/intelligence/classify.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-growth-'));

const UI_HTML = readFileSync('docs/lcc-command-vui.html', 'utf8');

describe('成長閉ループ（DIOS §10・§12-7）', () => {
  it('予実差のあるOutcomeから改善提案を1件生成し、承認前は適用されず、承認後にRuleVersion更新', () => {
    const s = new IntelligenceStore(tmp());
    const { event } = s.ingestRawEvent({ companyId: 'lcc', source: 'gmail', externalId: 'g1', content: { a: 1 } });
    const c = s.addCase(buildDecisionCase({ raw: event, text: '未入金の確認', entities: [], confirmedFacts: [], aiHypotheses: [], evidence: [] }));
    recordOutcome(s, { companyId: 'lcc', caseId: c.caseId, predicted: '3日以内に入金', actual: '7日後に入金', gapAnalysis: '先方承認フローが二段階だった' });
    const p = proposeFromOutcomes(s);
    expect(p).not.toBeNull();
    expect(p!.rationale).toContain('7日後に入金');
    expect(topPendingProposal(s)?.proposalId).toBe(p!.proposalId);
    expect(s.currentRule('rule-collection')).toBeNull(); // 承認前は未適用
    s.approveProposal(p!.proposalId, '坂本社長', { ruleId: 'rule-collection', name: '回収基準', body: '入金予測は承認フロー段数を確認', rollbackNote: 'previousBodyへ戻す', companyId: 'lcc' });
    expect(s.currentRule('rule-collection')?.currentVersion).toBe(1);
    // 同じOutcomeから重複提案しない
    expect(proposeFromOutcomes(s)).toBeNull();
  });

  it('予実差の実測がなければ提案を作らない（効果測定なしで成功扱いしない）', () => {
    const s = new IntelligenceStore(tmp());
    const { event } = s.ingestRawEvent({ companyId: 'lcc', source: 'gmail', externalId: 'g2', content: { a: 2 } });
    const c = s.addCase(buildDecisionCase({ raw: event, text: '見積の件', entities: [], confirmedFacts: [], aiHypotheses: [], evidence: [] }));
    recordOutcome(s, { companyId: 'lcc', caseId: c.caseId, predicted: '受注', actual: '受注' });
    expect(proposeFromOutcomes(s)).toBeNull();
  });
});

describe('DIOS-4 UI（判断1件原則・追跡/完了履歴分離）', () => {
  it('ホームは判断1件原則+件数表示、完了は履歴画面へ分離される', () => {
    expect(UI_HTML).toContain('topDecisions'); // 1件原則（緊急時最大3件）
    expect(UI_HTML).toContain('急ぎの判断はありません。');
    expect(UI_HTML).toContain('AIが追跡中');
    expect(UI_HTML).toContain('今日完了');
    expect(UI_HTML).toContain('完了履歴');
    expect(UI_HTML).toContain('完了は即時に通常表示から消える');
    expect(UI_HTML).toContain('相手の返答待ち'); // 状態の日本語ラベル
  });
});
