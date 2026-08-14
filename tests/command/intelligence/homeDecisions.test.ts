import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntelligenceStore } from '../../../src/command/intelligence/store.js';
import { processInboundEvent } from '../../../src/command/intelligence/inboundPipeline.js';
import { completeDecisionCase, homeDecisionCandidates, trackingCounts } from '../../../src/command/intelligence/homeDecisions.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'lcc-home-'));

const inbound = (s: IntelligenceStore, externalId: string, text: string) =>
  processInboundEvent(s, {
    companyId: 'lcc', source: 'gmail', externalId, content: { body: text }, text,
    fromLabel: '先方担当者', watchKey: `gmail:${externalId}`
  });

describe('ホーム判断候補（§B: リアルタイム層→主画面接続・決定論順位付け）', () => {
  it('E2E-5: PRESIDENT_DECISIONの新着がホーム最優先候補に載り、外部申告ラベルが付く', () => {
    const s = new IntelligenceStore(tmp());
    const r = inbound(s, 'm1', '山田様邸で金額変更のご相談です。至急ご判断ください');
    expect(r.createdCase).not.toBeNull();
    const cands = homeDecisionCandidates(s);
    expect(cands).toHaveLength(1);
    expect(cands[0].caseId).toBe(r.createdCase!.caseId);
    expect(cands[0].trustLabel).toBe('先方からの申告（未確認）'); // 外部申告を確定情報と表示しない（§F）
    expect(cands[0].presidentNextAction.length).toBeGreaterThan(3);
  });

  it('順位は決定論: 事故（safety）＞入金（cash）＞見積（E2E-5順位付け）', () => {
    const s = new IntelligenceStore(tmp());
    inbound(s, 'a', '値引のご相談です。ご承認ください');
    inbound(s, 'b', '先月分が未入金です。至急確認をお願いします');
    inbound(s, 'c', '現場で事故が発生しました。至急ご判断ください');
    const kinds = homeDecisionCandidates(s).map((c) => c.decisionKind);
    expect(kinds[0]).toBe('事故・クレーム');
    expect(kinds[1]).toBe('入金・回収');
  });

  it('E2E-6/7: 実結果つき完了でホームから消え、関連タスクも完了し、Outcomeが記録される（履歴は保持）', () => {
    const s = new IntelligenceStore(tmp());
    const r = inbound(s, 'm2', '追加費用の承認をお願いします。至急');
    const caseId = r.createdCase!.caseId;
    expect(homeDecisionCandidates(s)).toHaveLength(1);
    const done = completeDecisionCase(s, { caseId, actualOutcome: '追加費用を承認し先方合意' });
    expect(homeDecisionCandidates(s)).toHaveLength(0); // ホームから即時に消える
    expect(done.completedActions.length).toBeGreaterThanOrEqual(1); // 関連ActionItemも完了（OPENのまま残らない）
    expect(done.outcome.actual).toContain('先方合意'); // E2E-7: Outcome記録
    expect(done.outcome.predicted.length).toBeGreaterThan(0);
    // 履歴として保持（削除しない）
    expect(s.cases().find((c) => c.caseId === caseId)!.status).toBe('COMPLETED');
    expect(s.actions().every((a) => a.relatedCaseId !== caseId || a.status === 'COMPLETED')).toBe(true);
    expect(trackingCounts(s).completedTodayCount).toBeGreaterThanOrEqual(1); // JST当日完了として集計
  });

  it('実結果なしの完了と二重完了は拒否する（§C: Outcomeなしで成功扱いしない）', () => {
    const s = new IntelligenceStore(tmp());
    const r = inbound(s, 'm3', '契約変更のご相談。ご判断ください');
    const caseId = r.createdCase!.caseId;
    expect(() => completeDecisionCase(s, { caseId, actualOutcome: '  ' })).toThrow(/実結果/);
    completeDecisionCase(s, { caseId, actualOutcome: '条件付きで承認' });
    expect(() => completeDecisionCase(s, { caseId, actualOutcome: 'もう一度' })).toThrow(/完了済み/);
  });
});
