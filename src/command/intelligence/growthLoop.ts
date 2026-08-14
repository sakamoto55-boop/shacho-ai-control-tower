/**
 * 成長閉ループ（DIOS §10）: Outcome（予測と実結果の差）→ 改善提案1件 → 社長承認 → RuleVersion。
 *
 * - 提案は決定論生成（差分の実測がないものからは作らない＝効果測定なしで成功扱いしない）。
 * - 承認前は適用されない（store.approveProposalが強制）。自動merge/deploy/本番Writeはしない。
 * - 通常画面へ並べず、最重要1件のみ返す。
 */
import { IntelligenceStore } from './store.js';
import type { ImprovementProposal, Outcome } from './types.js';

/** 予測と実結果が異なるOutcomeから改善提案を1件だけ生成（既提案済みOutcomeは対象外） */
export function proposeFromOutcomes(store: IntelligenceStore, companyId = 'lcc'): ImprovementProposal | null {
  const outcomes = store.outcomes().filter((o) => o.companyId === companyId);
  const proposedFor = new Set(store.proposals().flatMap((p) => p.relatedOutcomeIds));
  const gaps = outcomes.filter((o) => o.predicted.trim() !== o.actual.trim() && !proposedFor.has(o.outcomeId));
  if (gaps.length === 0) return null; // 差分実測がなければ提案しない（捏造しない）
  const target = gaps[gaps.length - 1];
  return store.addProposal({
    companyId,
    title: `判断基準の見直し候補: ${target.predicted.slice(0, 30)} → 実際は ${target.actual.slice(0, 30)}`,
    rationale: `Outcome ${target.outcomeId}: 予測「${target.predicted.slice(0, 60)}」に対し実結果「${target.actual.slice(0, 60)}」。${target.gapAnalysis ?? '原因分析は未入力'}`,
    metric: '同種判断の予実差（次回以降のOutcomeで再測定）',
    risk: '基準変更により従来うまくいっていたケースへ影響する可能性',
    relatedOutcomeIds: [target.outcomeId]
  });
}

/** ホーム表示用: 未承認の最重要提案を1件だけ（並べない） */
export function topPendingProposal(store: IntelligenceStore): ImprovementProposal | null {
  const pending = store.proposals().filter((p) => p.status === 'PROPOSED');
  return pending.length ? pending[pending.length - 1] : null;
}

/** Outcome記録ヘルパー（DecisionCase完了時に予測・実結果・差分を残す） */
export function recordOutcome(
  store: IntelligenceStore,
  input: { companyId: string; caseId: string; predicted: string; actual: string; gapAnalysis?: string }
): Outcome {
  store.updateCaseStatus(input.caseId, 'COMPLETED', input.actual);
  return store.addOutcome({
    companyId: input.companyId,
    relatedCaseId: input.caseId,
    predicted: input.predicted,
    actual: input.actual,
    gapAnalysis: input.gapAnalysis ?? null
  });
}
