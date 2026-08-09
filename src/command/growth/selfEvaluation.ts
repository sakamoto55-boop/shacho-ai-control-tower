/**
 * AI Self-Evaluation / Provider Learning（Phase GROWTH §21-§23）。
 *
 * LCC COMMAND自身の品質を決定論的に測定する。
 * - 1つの総合点だけで品質判断しない（§22。内訳を必ず保持）
 * - Provider別の実績はModel Router選択の改善に使える形で蓄積（§23。少数サンプルへ過適合しない）
 * - 測定データがなければ「効果測定できていません」（§41。改善を偽らない）
 */
import type { ObservabilityEntry } from '../observability/observability.js';
import type { AgentTraceEntry } from '../agents/executor.js';

export interface AiSelfEvaluation {
  sampleSize: number;
  /** 数値回答へのEvidence添付率の代理指標: confidence HIGH率 */
  metrics: {
    answerCount: number;
    unknownRate: number;
    highConfidenceRate: number;
    correctionRate: number;
    feedbackGoodRate: number | null;
    avgLatencyMs: number;
    approxTokens: number;
  };
  perProvider: Array<{
    providerId: string;
    tasks: number;
    successRate: number;
    avgLatencyMs: number;
  }>;
  /** Growth Score（§22）。内訳とセットでのみ意味を持つ */
  compositeScore: number | null;
  note: string;
}

export function computeSelfEvaluation(
  entries: ObservabilityEntry[],
  traces: AgentTraceEntry[]
): AiSelfEvaluation {
  const chats = entries.filter((e) => e.kind === 'chat');
  const feedback = entries.filter((e) => e.kind === 'feedback');
  const answerCount = chats.length;

  if (answerCount === 0) {
    return {
      sampleSize: 0,
      metrics: {
        answerCount: 0,
        unknownRate: 0,
        highConfidenceRate: 0,
        correctionRate: 0,
        feedbackGoodRate: null,
        avgLatencyMs: 0,
        approxTokens: 0
      },
      perProvider: [],
      compositeScore: null,
      note: '会話サンプルがまだありません。実運用開始後に測定されます（効果測定できていません）'
    };
  }

  const unknownRate = chats.filter((e) => e.confidence === 'UNKNOWN').length / answerCount;
  const highConfidenceRate = chats.filter((e) => e.confidence === 'HIGH').length / answerCount;
  const correctionRate =
    chats.filter((e) => e.intent === 'memory_correction' || e.intent === 'correction').length / answerCount;
  const feedbackGoodRate =
    feedback.length > 0 ? feedback.filter((e) => e.rating === 'good').length / feedback.length : null;
  const avgLatencyMs = Math.round(
    chats.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) / answerCount
  );
  const approxTokens = entries
    .filter((e) => e.kind === 'llm_call')
    .reduce((sum, e) => sum + (e.approxTokens ?? 0), 0);

  const providerMap = new Map<string, { tasks: number; success: number; latency: number }>();
  for (const trace of traces) {
    const entry = providerMap.get(trace.providerId) ?? { tasks: 0, success: 0, latency: 0 };
    entry.tasks += 1;
    if (trace.success) entry.success += 1;
    entry.latency += trace.latencyMs;
    providerMap.set(trace.providerId, entry);
  }
  const perProvider = [...providerMap.entries()].map(([providerId, v]) => ({
    providerId,
    tasks: v.tasks,
    successRate: v.tasks > 0 ? Math.round((v.success / v.tasks) * 100) / 100 : 0,
    avgLatencyMs: v.tasks > 0 ? Math.round(v.latency / v.tasks) : 0
  }));

  // §22: Dashboard用の総合指標（内訳保持が前提。サンプル少数時はnull）
  const compositeScore =
    answerCount >= 20
      ? Math.round(
          (highConfidenceRate * 0.4 +
            (1 - unknownRate) * 0.2 +
            (1 - correctionRate) * 0.2 +
            (feedbackGoodRate ?? 0.5) * 0.2) *
            100
        )
      : null;

  return {
    sampleSize: answerCount,
    metrics: {
      answerCount,
      unknownRate: Math.round(unknownRate * 100) / 100,
      highConfidenceRate: Math.round(highConfidenceRate * 100) / 100,
      correctionRate: Math.round(correctionRate * 100) / 100,
      feedbackGoodRate: feedbackGoodRate === null ? null : Math.round(feedbackGoodRate * 100) / 100,
      avgLatencyMs,
      approxTokens
    },
    perProvider,
    compositeScore,
    note:
      compositeScore === null
        ? `サンプル${answerCount}件は総合評価には不足（20件以上で算出）。内訳指標のみ参照してください`
        : '総合指標は内訳とセットで参照してください（1点だけで品質判断しない）'
  };
}
