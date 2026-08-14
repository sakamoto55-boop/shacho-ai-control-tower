/**
 * ホーム「今日の判断」候補（§B）とDecisionCase完了（§C）。
 *
 * - WAITING_PRESIDENTのDecisionCaseをホーム最優先候補とする（リアルタイム層→主画面接続）。
 * - 順位付けは決定論: safety > cash > deadline(近い順) > credit > その他。LLMに順位を決めさせない。
 * - 「今日」はJST当日のみ（utils/jst経由。ISO sliceでUTC判定しない）。
 * - 外部メッセージ由来は「先方からの申告」ラベルを付け、確定情報と表示しない（非捏造）。
 * - 完了は2種類を分離: 通常タスク完了（ActionItem）と社長判断完了（DecisionCase+実結果+Outcome）。
 */
import { jstDate } from '../utils/jst.js';
import { IntelligenceStore } from './store.js';
import type { DecisionCase, IntelligenceActionItem, Outcome } from './types.js';

export interface HomeDecisionCandidate {
  caseId: string;
  actionId: string | null;
  title: string;
  decisionKind: DecisionCase['decisionKind'];
  presidentNextAction: string;
  aiRecommendation: string;
  recommendationReason: string;
  riskIfWrong: string;
  missingInformation: string[];
  deadline: string | null;
  amountYen: number | null;
  /** 外部申告は確定情報と区別して表示する（§F/非捏造） */
  trustLabel: string;
  /** 決定論順位（小さいほど優先） */
  rank: number;
  createdAt: string;
}

const KIND_RANK: Record<DecisionCase['decisionKind'], number> = {
  '事故・クレーム': 0, // safety最優先
  '入金・回収': 1, // cash
  '見積・受注': 2,
  '配置・日報': 3,
  'その他': 4
};

function trustLabelOf(c: DecisionCase): string {
  const trusts = new Set(c.evidence.map((e) => e.trust));
  if (trusts.has('SOURCE_OF_TRUTH')) return '正本確認済み';
  if (trusts.has('EXTERNAL_CLAIM')) return '先方からの申告（未確認）';
  if (trusts.has('AI_HYPOTHESIS')) return 'AI仮説（未確認）';
  return '出典区分なし';
}

/**
 * ホーム最優先候補（未完了のWAITING_PRESIDENT関連ケースのみ）。
 * 完了・却下・アーカイブ済みは即座に候補から消える（履歴はstoreに保持）。
 */
export function homeDecisionCandidates(store: IntelligenceStore, companyId = 'lcc'): HomeDecisionCandidate[] {
  const cases = store.cases().filter((c) => c.companyId === companyId && c.status === 'OPEN' && !c.supersededBy);
  const actions = store.actions();
  const list = cases.map((c) => {
    const act = actions.find((a) => a.relatedCaseId === c.caseId && a.status === 'WAITING_PRESIDENT') ?? null;
    return { c, act };
  }).filter((x) => x.act !== null); // 社長判断待ちアクションがあるケースのみ（ホームは判断の場）
  const nowJst = jstDate(new Date().toISOString());
  const scored = list.map(({ c, act }) => {
    const dlJst = c.impact.deadline ? jstDate(c.impact.deadline) : null;
    const deadlineScore = dlJst === null ? 2 : dlJst <= nowJst ? 0 : 1; // 今日以前=0が最優先
    const rank = KIND_RANK[c.decisionKind] * 10 + deadlineScore;
    const cand: HomeDecisionCandidate = {
      caseId: c.caseId,
      actionId: act!.actionId,
      title: c.title,
      decisionKind: c.decisionKind,
      presidentNextAction: c.presidentNextAction,
      aiRecommendation: c.aiRecommendation,
      recommendationReason: c.recommendationReason,
      riskIfWrong: c.riskIfWrong,
      missingInformation: c.missingInformation,
      deadline: c.impact.deadline,
      amountYen: c.impact.amountYen,
      trustLabel: trustLabelOf(c),
      rank,
      createdAt: c.createdAt
    };
    return cand;
  });
  return scored.sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt));
}

/** JST当日の追跡件数（§B: 「今日」表示はJST当日限定。過去・未完了・返信待ちを混同しない） */
export function trackingCounts(store: IntelligenceStore): {
  trackingCount: number;
  completedTodayCount: number;
  waitingPresidentCount: number;
  awaitingReplyCount: number;
} {
  const actions = store.actions();
  const todayJst = jstDate(new Date().toISOString());
  return {
    trackingCount: actions.filter((a) => !['COMPLETED', 'ARCHIVED'].includes(a.status)).length,
    completedTodayCount: actions.filter((a) => a.status === 'COMPLETED' && a.completedAt && jstDate(a.completedAt) === todayJst).length,
    waitingPresidentCount: actions.filter((a) => a.status === 'WAITING_PRESIDENT').length,
    awaitingReplyCount: actions.filter((a) => a.status === 'WAITING_EXTERNAL').length
  };
}

export interface CompleteCaseResult {
  case: DecisionCase;
  completedActions: IntelligenceActionItem[];
  outcome: Outcome;
}

/**
 * 社長判断の完了（§C）: 実結果（actualOutcome）必須。
 * DecisionCase→COMPLETED、関連ActionItem→COMPLETED、Outcome（予測vs実結果）を同時に整合させる。
 * Outcomeなしの完了は拒否（効果測定なしで成功扱いしない）。
 */
export function completeDecisionCase(
  store: IntelligenceStore,
  input: { caseId: string; actualOutcome: string; predicted?: string }
): CompleteCaseResult {
  const actual = (input.actualOutcome ?? '').trim();
  if (!actual) throw new Error('実結果（actualOutcome）なしで社長判断は完了できません');
  const target = store.cases().find((c) => c.caseId === input.caseId);
  if (!target) throw new Error('対象のDecisionCaseが見つかりません');
  if (target.status === 'COMPLETED') throw new Error('このDecisionCaseは完了済みです');
  const updated = store.updateCaseStatus(input.caseId, 'COMPLETED', actual)!;
  const completedActions: IntelligenceActionItem[] = [];
  for (const a of store.actions()) {
    if (a.relatedCaseId === input.caseId && !['COMPLETED', 'ARCHIVED'].includes(a.status)) {
      const u = store.updateActionStatus(a.actionId, 'COMPLETED');
      if (u) completedActions.push(u);
    }
  }
  const outcome = store.addOutcome({
    companyId: target.companyId,
    relatedCaseId: input.caseId,
    predicted: (input.predicted ?? target.aiRecommendation).slice(0, 300),
    actual: actual.slice(0, 300),
    gapAnalysis: null
  });
  return { case: updated, completedActions, outcome };
}
