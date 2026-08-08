/**
 * Daily / Weekly / Monthly Growth Review（Phase GROWTH §34-§37・§39-§41）。
 *
 * - 毎日大量に提案しない（上位のみ・§34）
 * - 「改善した」と言う場合は必ずEvidence（§40）。測定データがなければ
 *   「効果測定できていません」と正直に言う（§41）
 */
import type { ExperimentRecord, MemoryRecord } from '../memory/types.js';
import type { GrowthCandidate, RepairCandidate } from './growthBacklog.js';
import type { GrowthPattern, GrowthSignal } from './growthEngine.js';
import type { AiSelfEvaluation } from './selfEvaluation.js';

export interface GrowthReviewInput {
  signals: GrowthSignal[];
  patterns: GrowthPattern[];
  backlog: GrowthCandidate[];
  repairs: RepairCandidate[];
  experiments: ExperimentRecord[];
  lessons: MemoryRecord[];
  selfEvaluation: AiSelfEvaluation;
}

function topProposalLines(backlog: GrowthCandidate[], limit: number): string[] {
  const top = backlog
    .filter((c) => c.status === 'NEW' || c.status === 'PROPOSED')
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, limit);
  if (top.length === 0) return ['・新しい改善候補はありません'];
  const total = backlog.filter((c) => c.status === 'NEW' || c.status === 'PROPOSED').length;
  return [
    `改善候補を${total}件検出しています。経営インパクトが大きい上位${top.length}件のみ報告します:`,
    ...top.map(
      (c) =>
        `・[${c.domain}] ${c.title}（優先度${c.priority.score}）${c.constitutionWarnings.length > 0 ? ' ⚠会社原則との照合注意あり' : ''}`
    )
  ];
}

/** 日次（§35）: 重要異常・新Pattern・Data Quality・Experiment状況 */
export function buildDailyGrowthReview(input: GrowthReviewInput): string {
  const negatives = input.signals.filter((s) => s.negative);
  const running = input.experiments.filter((e) => e.status === 'RUNNING' || e.status === 'AWAITING_RESULT');
  return [
    '【Daily Growth Review】',
    '',
    '〈重要異常（前回比の変化）〉',
    ...(negatives.length > 0 ? negatives.slice(0, 5).map((s) => `・${s.statement}`) : ['・新しい異常はありません']),
    '',
    '〈新しい繰り返しPattern〉',
    ...(input.patterns.length > 0 ? input.patterns.map((p) => `・${p.statement}`) : ['・なし']),
    '',
    `〈データ品質〉修正候補 ${input.repairs.filter((r) => r.status === 'PROPOSED').length}件（人間確認待ち）`,
    `〈実験〉進行中 ${running.length}件 / 結果待ち ${input.experiments.filter((e) => e.status === 'AWAITING_RESULT').length}件`
  ].join('\n');
}

/** 週次（§36） */
export function buildWeeklyGrowthReview(input: GrowthReviewInput): string {
  const completed = input.experiments.filter((e) => e.status === 'COMPLETED');
  return [
    '【Weekly Growth Review】',
    '',
    '〈今週発見した問題〉',
    ...(input.signals.filter((s) => s.negative).slice(0, 5).map((s) => `・${s.statement}`) ?? []),
    ...(input.signals.filter((s) => s.negative).length === 0 ? ['・なし'] : []),
    '',
    '〈改善候補（上位のみ）〉',
    ...topProposalLines(input.backlog, 2),
    '',
    '〈実験結果〉',
    ...(completed.length > 0
      ? completed.slice(-3).map((e) => `・${e.hypothesis}: ${e.result ?? ''}（${e.evaluation ?? '評価中'}）`)
      : ['・完了した実験はありません']),
    '',
    '〈新しいLesson〉',
    ...(input.lessons.length > 0
      ? input.lessons.slice(-3).map((m) => `・${m.statement.slice(0, 60)}`)
      : ['・なし']),
    '',
    '〈AI自身の状態〉',
    `・${input.selfEvaluation.note}`
  ].join('\n');
}

/** 月次（§37） */
export function buildMonthlyIntelligenceReview(input: GrowthReviewInput): string {
  const improved = input.signals.filter((s) => !s.negative);
  const worsened = input.signals.filter((s) => s.negative);
  const eva = input.selfEvaluation;
  return [
    '【Monthly Intelligence Review】',
    '',
    '〈会社が学んだこと（Lesson）〉',
    ...(input.lessons.length > 0 ? input.lessons.slice(-5).map((m) => `・${m.statement.slice(0, 70)}`) : ['・記録なし']),
    '',
    '〈改善したこと（Evidenceがあるもののみ）〉',
    ...(improved.length > 0
      ? improved.map((s) => `・${s.statement}`)
      : ['・測定データが揃った改善はまだありません（効果測定できていません）']),
    '',
    '〈悪化したこと〉',
    ...(worsened.length > 0 ? worsened.slice(0, 5).map((s) => `・${s.statement}`) : ['・なし']),
    '',
    '〈AI精度〉',
    eva.sampleSize > 0
      ? `・回答${eva.metrics.answerCount}件 / HIGH確信度率${Math.round(eva.metrics.highConfidenceRate * 100)}% / UNKNOWN率${Math.round(eva.metrics.unknownRate * 100)}% / 平均${eva.metrics.avgLatencyMs}ms`
      : `・${eva.note}`,
    '',
    '〈Provider実績〉',
    ...(eva.perProvider.length > 0
      ? eva.perProvider.map((p) => `・${p.providerId}: ${p.tasks}タスク / 成功率${Math.round(p.successRate * 100)}%`)
      : ['・実績なし']),
    '',
    '〈Playbook候補〉',
    ...(input.lessons.filter((m) => m.type === 'PLAYBOOK').length > 0
      ? input.lessons.filter((m) => m.type === 'PLAYBOOK').map((m) => `・${m.statement.slice(0, 60)}（承認待ち）`)
      : ['・なし（同一Lessonの再現を待っています）'])
  ].join('\n');
}
