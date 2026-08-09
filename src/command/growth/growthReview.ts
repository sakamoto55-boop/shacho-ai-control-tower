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
  /** Beta Incident Log の種類別集計（LIVE BETA §19。未指定は未計測扱い） */
  incidents?: Array<{ kind: string; total: number; open: number }>;
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

/** 週次（§36・LIVE BETA §15: Company/AI/Dataの3分離を必ず維持する） */
export function buildWeeklyGrowthReview(input: GrowthReviewInput): string {
  const completed = input.experiments.filter((e) => e.status === 'COMPLETED');
  const companySignals = input.signals.filter((s) => s.negative && s.domain === 'COMPANY');
  const dataSignals = input.signals.filter((s) => s.negative && s.domain === 'DATA');
  const aiCandidates = input.backlog.filter((c) => c.domain === 'AI');
  const dataCandidates = input.backlog.filter((c) => c.domain === 'DATA');
  const eva = input.selfEvaluation;
  return [
    '【Weekly Growth Review】',
    '',
    '■ Company Growth（会社の成長）',
    '〈今週発見した問題〉',
    ...(companySignals.length > 0 ? companySignals.slice(0, 5).map((s) => `・${s.statement}`) : ['・なし']),
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
    '■ AI Growth（AI自身の成長）',
    `・${eva.note}`,
    ...(eva.sampleSize > 0
      ? [
          `・回答${eva.metrics.answerCount}件 / HIGH確信度率${Math.round(eva.metrics.highConfidenceRate * 100)}% / UNKNOWN率${Math.round(eva.metrics.unknownRate * 100)}%`
        ]
      : []),
    ...(aiCandidates.length > 0 ? [`・AI改善候補: ${aiCandidates.length}件`] : []),
    ...(input.incidents !== undefined
      ? input.incidents.length > 0
        ? input.incidents.map((i) => `・Incident ${i.kind}: ${i.total}件（未解決${i.open}件）`)
        : ['・Incident: なし']
      : ['・Incident: 未計測（LIVE BETA開始後に記録されます）']),
    '',
    '■ Data Growth（データの成長）',
    `・修正候補（人間確認待ち）: ${input.repairs.filter((r) => r.status === 'PROPOSED').length}件 / 確定済み: ${input.repairs.filter((r) => r.status === 'CONFIRMED').length}件`,
    ...(dataSignals.length > 0 ? dataSignals.slice(0, 3).map((s) => `・${s.statement}`) : ['・データ品質の新しい悪化: なし']),
    ...(dataCandidates.length > 0 ? [`・データ改善候補: ${dataCandidates.length}件`] : [])
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
