/**
 * Autonomy Review / President Decision Load（LIVE BETA §10-§11・§18）。
 *
 * - 自律実行レベルは初期LEVEL 1（Observe/Analyze/Recommend のみ）。
 * - LEVEL 2への引き上げは、運用データに基づく「提案」まで。勝手に昇格しない。
 * - 評価データが不足している間は「評価できません」を正直に返す（§41と同じ原則）。
 * - President Decision Load: 「社長へ上げる必要がない問題を減らす」をCompany Outcomeとして
 *   測定可能にするための追跡候補KPI（決定論集計のみ）。
 */
import type { ObservabilityEntry } from '../observability/observability.js';
import type { CommandStore } from '../repositories/CommandRepository.js';
import type { IncidentRecord } from '../livebeta/incidentLog.js';
import type { GrowthCandidate } from './growthBacklog.js';

export const CURRENT_AUTONOMY_LEVEL = 1;
export const AUTONOMY_LEVEL_DESCRIPTIONS: Record<number, string> = {
  0: '停止（観測もしない）',
  1: '観測・分析・提案のみ（現在。実験Draft作成可・自動実行なし）',
  2: '低リスク実験の自動開始（承認済みテンプレートのみ）',
  3: '社内通知の自動実行（Approval済みLEVEL 3 Write）',
  4: '外部送信を含む実行（強い承認必須）',
  5: '完全自律（採用しない）'
};

/** Autonomy Review の最小サンプル条件（少数データで昇格判断しない） */
export const AUTONOMY_MIN_SAMPLES = { chats: 50, days: 7 };

export interface AutonomyReview {
  currentLevel: number;
  evaluable: boolean;
  metrics: {
    chatCount: number;
    observedDays: number;
    unknownRate: number | null;
    correctionRate: number | null;
    feedbackGoodRate: number | null;
    /** 誤回答Incident率（回答数比） */
    falsePositiveRate: number | null;
    openIncidents: number;
    proposalCount: number;
    proposalApprovedOrExperimenting: number;
  };
  recommendation: string;
  note: string;
}

export function computeAutonomyReview(
  entries: ObservabilityEntry[],
  incidents: IncidentRecord[],
  backlog: GrowthCandidate[]
): AutonomyReview {
  const chats = entries.filter((e) => e.kind === 'chat');
  const feedback = entries.filter((e) => e.kind === 'feedback');
  const days = new Set(chats.map((e) => e.timestamp.slice(0, 10))).size;
  const openIncidents = incidents.filter((i) => i.status === 'OPEN').length;
  const proposals = backlog.filter((c) => c.status !== 'REJECTED');
  const progressed = backlog.filter(
    (c) => c.status === 'APPROVED' || c.status === 'EXPERIMENTING' || c.status === 'LEARNED'
  );

  const evaluable = chats.length >= AUTONOMY_MIN_SAMPLES.chats && days >= AUTONOMY_MIN_SAMPLES.days;
  const rate = (n: number, d: number): number | null =>
    d > 0 ? Math.round((n / d) * 100) / 100 : null;

  const unknownRate = rate(chats.filter((e) => e.confidence === 'UNKNOWN').length, chats.length);
  const correctionRate = rate(
    chats.filter((e) => e.intent === 'memory_correction' || e.intent === 'correction').length,
    chats.length
  );
  const feedbackGoodRate = rate(
    feedback.filter((e) => e.rating === 'good').length,
    feedback.length
  );
  const falsePositiveRate = rate(
    incidents.filter((i) => i.kind === 'WRONG_ANSWER').length,
    chats.length
  );

  let recommendation: string;
  if (!evaluable) {
    recommendation = `LEVEL ${CURRENT_AUTONOMY_LEVEL} を維持します。昇格判断には最低${AUTONOMY_MIN_SAMPLES.days}日・${AUTONOMY_MIN_SAMPLES.chats}会話の運用データが必要です（現在${days}日・${chats.length}会話）。`;
  } else {
    const healthy =
      (correctionRate ?? 1) <= 0.05 &&
      (falsePositiveRate ?? 1) <= 0.02 &&
      openIncidents === 0 &&
      (feedbackGoodRate === null || feedbackGoodRate >= 0.8);
    recommendation = healthy
      ? `運用指標は良好です。LEVEL 2（低リスク実験の自動開始）への引き上げを「提案」します。昇格には社長の明示承認が必要です（AIは自分で昇格しません）。`
      : `LEVEL ${CURRENT_AUTONOMY_LEVEL} の維持を推奨します（訂正率・誤回答Incident・未解決Incidentのいずれかが基準を満たしていません）。`;
  }

  return {
    currentLevel: CURRENT_AUTONOMY_LEVEL,
    evaluable,
    metrics: {
      chatCount: chats.length,
      observedDays: days,
      unknownRate,
      correctionRate,
      feedbackGoodRate,
      falsePositiveRate,
      openIncidents,
      proposalCount: proposals.length,
      proposalApprovedOrExperimenting: progressed.length
    },
    recommendation,
    note: evaluable
      ? '判定は決定論指標のみ。最終判断は社長です。'
      : '評価データが不足しています（効果測定できていません）。'
  };
}

/**
 * President Decision Load（§18・追跡候補KPI）。
 * 「社長判断が必要だった件数」を決定論で集計する。実運用データが無い間は正直にゼロ+注記。
 */
export interface PresidentDecisionLoad {
  /** 承認リクエスト（社長判断を要求した件数） */
  approvalRequested: number;
  approvalDecided: number;
  approvalWaiting: number;
  /** 経営判断Memoryとして記録された件数 */
  decisionsRecorded: number;
  /** AI回答で完結した会話数（承認・判断を要求しなかった会話） */
  chatsWithoutEscalation: number;
  totalChats: number;
  note: string;
}

export function computePresidentDecisionLoad(
  store: Pick<CommandStore, 'approvals' | 'decisions'>,
  entries: ObservabilityEntry[]
): PresidentDecisionLoad {
  const chats = entries.filter((e) => e.kind === 'chat');
  const approvalRequested = store.approvals.length;
  const approvalWaiting = store.approvals.filter((a) => a.status === 'waiting').length;
  return {
    approvalRequested,
    approvalDecided: approvalRequested - approvalWaiting,
    approvalWaiting,
    decisionsRecorded: store.decisions.length,
    chatsWithoutEscalation: Math.max(chats.length - approvalRequested, 0),
    totalChats: chats.length,
    note:
      chats.length === 0
        ? '実運用データがまだありません。LIVE BETA開始後に「社長へ上げる必要がない問題を減らせたか」を測定します（追跡候補KPI）'
        : '追跡候補KPI: AIで解決/部門で完結/本当に社長判断が必要 の分類は運用ラベル付けの蓄積後に精緻化します'
  };
}
