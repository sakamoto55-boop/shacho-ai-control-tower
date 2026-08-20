import { describe, expect, it } from 'vitest';
import { buildAdviceDraft } from '../../src/command/intelligence/adviceDraft.js';
import type { DecisionCase } from '../../src/command/intelligence/types.js';

function makeCase(over: Partial<DecisionCase> = {}): DecisionCase {
  return {
    caseId: 'case-1',
    companyId: 'lcc',
    decisionKind: 'その他',
    title: 'B現場 追加費用の報告',
    whatHappened: 'B現場で追加の残置物が見つかった',
    entities: [],
    confirmedFacts: ['B現場で残置物を追加確認'],
    aiHypotheses: [],
    missingInformation: ['追加分の数量', '施主の意向'],
    evidence: [],
    impact: { amountYen: null, deadline: null, grossMarginNote: null, cashNote: null, safetyNote: null, staffingNote: null, creditNote: null },
    options: [],
    aiRecommendation: '数量確認後に見積を作成',
    recommendationReason: 'ルール',
    riskIfWrong: '粗利毀損',
    presidentNextAction: '現場の追加数量を写真付きで報告してください',
    afterApprovalPlan: '',
    completionCriteria: '',
    actualOutcome: null,
    status: 'OPEN',
    createdAt: '2026-08-20T00:00:00Z',
    sourceRawEventIds: [],
    supersededBy: null,
    ...over
  };
}

describe('営業日報 返信アドバイス下書き（決定論・承認制）', () => {
  it('宛名（さん付け）・要点・確認質問を実データから組み立てる', () => {
    const a = buildAdviceDraft(makeCase(), '田中');
    expect(a.draft).toContain('田中さん');
    expect(a.draft).toContain('B現場で残置物を追加確認');
    expect(a.draft).toContain('追加分の数量');
    expect(a.draft).toContain('施主の意向');
    expect(a.approvalStatus).toBe('waiting');
    expect(a.guard).toMatch(/下書き|承認/);
  });

  it('次アクションに危険語（見積・金額等）が含まれる場合は断定せず確認に丸める', () => {
    const a = buildAdviceDraft(makeCase({ presidentNextAction: '150万円で見積を出して契約してください' }), '田中');
    expect(a.draft).not.toContain('150万円で見積を出して契約');
    expect(a.draft).toContain('確認が取れ次第');
  });

  it('送信者不明（lineworks/unknown）は宛名を「担当者」にする', () => {
    const a = buildAdviceDraft(makeCase(), 'lineworks');
    expect(a.draft).toContain('担当者、報告ありがとうございます');
  });

  it('確認済み事実が無ければ本文要約にフォールバックする', () => {
    const a = buildAdviceDraft(makeCase({ confirmedFacts: [] }), '田中');
    expect(a.draft).toContain('内容を確認しました');
    expect(a.basis.confirmedFacts).toBe(0);
  });
});
