/**
 * Nightly Memory Maintenance + Proactive Problem Discovery + Experiment Engine補助。
 *
 * 自動で事実を書き換えず、ルールに基づく更新候補・報告を作る。
 * 機械的に確定できるのは「validUntil経過によるEXPIRED遷移」のみ。
 */
import type { CommandRepository } from '../repositories/CommandRepository.js';
import type { CommandDataset } from '../data/seed.js';
import type { CompanyScope } from '../domain/types.js';
import { computeProjectMargin } from '../engines/margin.js';
import { COST_CATEGORY_LABELS } from '../domain/types.js';
import { similarity } from './store.js';
import type { ExperimentRecord } from './types.js';

export interface MaintenanceReport {
  ranAt: string;
  expiredDecisions: string[];
  unverifiedHypotheses: string[];
  pendingReviewMemories: string[];
  duplicateCandidates: Array<{ a: string; b: string }>;
  conflicts: Array<{ a: string; b: string }>;
  experimentsAwaitingResult: string[];
  archiveCandidates: string[];
  proactiveInsights: string[];
}

/** 日々のデータから反復問題・矛盾・期限切れを検出する（重要なものだけ提案） */
export function discoverProblems(dataset: CommandDataset, scope: CompanyScope): string[] {
  const insights: string[] = [];
  const margins = dataset.projects
    .filter((p) => p.orderAmount > 0 && (scope === 'group' || p.companyId === scope))
    .map((p) => computeProjectMargin(dataset, p))
    .filter((m) => m.forecastMarginRate !== null);
  const lowMargin = margins.filter(
    (m) => (m.forecastMarginRate as number) < m.plannedMarginRate - 0.03
  );
  if (lowMargin.length >= 2) {
    const driverCount = new Map<string, number>();
    for (const margin of lowMargin) {
      for (const driver of margin.varianceDrivers) {
        driverCount.set(driver.category, (driverCount.get(driver.category) ?? 0) + 1);
      }
    }
    const [topCategory, count] = [...driverCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (topCategory && (count as number) >= 2) {
      const label =
        COST_CATEGORY_LABELS[topCategory as keyof typeof COST_CATEGORY_LABELS] ?? topCategory;
      insights.push(
        `低粗利案件${lowMargin.length}件のうち${count}件で${label}費超過が共通しています。個別の見積ミスではなく、${label}単価設定・見積基準の問題として再分析する価値があります。`
      );
    }
  }
  return insights;
}

export async function runMemoryMaintenance(
  repository: CommandRepository,
  asOf: string,
  dataset?: CommandDataset
): Promise<MaintenanceReport> {
  const memories = await repository.getMemories();
  const experiments = await repository.getExperiments();
  const today = asOf.slice(0, 10);
  const report: MaintenanceReport = {
    ranAt: asOf,
    expiredDecisions: [],
    unverifiedHypotheses: [],
    pendingReviewMemories: [],
    duplicateCandidates: [],
    conflicts: [],
    experimentsAwaitingResult: [],
    archiveCandidates: [],
    proactiveInsights: dataset ? discoverProblems(dataset, 'group') : []
  };

  const active = memories.filter((m) => m.status === 'ACTIVE');
  for (const memory of active) {
    // 期限切れ: ルールに基づく機械的遷移のみ自動（内容は書き換えない）
    if (memory.validUntil && memory.validUntil < today) {
      memory.status = 'EXPIRED';
      memory.updatedAt = asOf;
      await repository.saveMemory(memory);
      if (memory.type === 'DECISION') report.expiredDecisions.push(memory.statement);
      continue;
    }
    if (memory.type === 'HYPOTHESIS' && memory.confidence === 'UNVERIFIED') {
      report.unverifiedHypotheses.push(memory.statement);
    }
    if (memory.reviewStatus === 'PENDING_REVIEW') {
      report.pendingReviewMemories.push(memory.statement);
    }
    if (memory.relations.some((relation) => relation.kind === 'conflictsWith')) {
      for (const relation of memory.relations.filter((r) => r.kind === 'conflictsWith')) {
        report.conflicts.push({ a: memory.memoryId, b: relation.targetMemoryId ?? '?' });
      }
    }
    // 90日以上更新のない低信頼CONTEXTはArchive候補（自動Archiveはしない）
    const ageDays = (Date.parse(asOf) - Date.parse(memory.updatedAt)) / 86_400_000;
    if (memory.type === 'CONTEXT' && ageDays > 90) report.archiveCandidates.push(memory.statement);
  }

  // 重複候補（保存時に弾けなかった近似ペア）
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (
        active[i].type === active[j].type &&
        similarity(active[i].statement, active[j].statement) >= 0.5
      ) {
        report.duplicateCandidates.push({ a: active[i].memoryId, b: active[j].memoryId });
      }
    }
  }

  // Result Feedback Loop: 結果未登録の実験を確認する
  for (const experiment of experiments) {
    const overdue = experiment.plannedEndAt && experiment.plannedEndAt < today;
    if ((experiment.status === 'RUNNING' && overdue) || experiment.status === 'AWAITING_RESULT') {
      report.experimentsAwaitingResult.push(
        `「${experiment.hypothesis}」の実験結果がまだ登録されていません（指標: ${experiment.metric} / 開始: ${experiment.startedAt}）`
      );
      if (experiment.status === 'RUNNING' && overdue) {
        experiment.status = 'AWAITING_RESULT';
        experiment.updatedAt = asOf;
        await repository.saveExperiment(experiment);
      }
    }
  }

  return report;
}

let expSeq = 0;
export function resetExperimentSeq(): void {
  expSeq = 0;
}

/** 実験の登録（提案して終わりにしないための入口） */
export function buildExperiment(
  input: Pick<ExperimentRecord, 'companyId' | 'hypothesis' | 'metric' | 'baseline' | 'target'> &
    Partial<Pick<ExperimentRecord, 'hypothesisMemoryId' | 'plannedEndAt'>>,
  createdBy: string,
  now: string
): ExperimentRecord {
  return {
    experimentId: `exp-${now.slice(0, 10)}-${expSeq++}`,
    companyId: input.companyId,
    hypothesisMemoryId: input.hypothesisMemoryId,
    hypothesis: input.hypothesis,
    metric: input.metric,
    baseline: input.baseline,
    target: input.target,
    startedAt: now.slice(0, 10),
    plannedEndAt: input.plannedEndAt,
    status: 'RUNNING',
    createdBy,
    createdAt: now,
    updatedAt: now
  };
}

/** 実験結果の登録 → 成功/失敗の両方をLESSON化するための材料を返す */
export function completeExperiment(
  experiment: ExperimentRecord,
  result: string,
  evaluation: string,
  now: string
): { experiment: ExperimentRecord; lessonStatement: string } {
  experiment.result = result;
  experiment.evaluation = evaluation;
  experiment.status = 'COMPLETED';
  experiment.updatedAt = now;
  return {
    experiment,
    lessonStatement: `実験「${experiment.hypothesis}」の結果: ${experiment.metric} ${experiment.baseline} → ${result}。評価: ${evaluation}`
  };
}
