import { randomUUID as persistentUuid } from 'node:crypto';
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
import { MemoryService, similarity } from './store.js';
import type { ExperimentRecord, MemoryRecord } from './types.js';

export interface RankedInsight {
  text: string;
  impact: number;
  urgency: number;
  confidence: number;
  actionability: number;
  score: number;
}

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
  /** ランキング済みInsight（低価値は含めない） */
  rankedInsights: RankedInsight[];
  /** 複数LESSONから抽出したPlaybook候補（自動で正式ルール化しない） */
  playbookCandidates: string[];
  /** 一貫した判断傾向から抽出したPrinciple候補（ユーザー承認で格上げ） */
  principleCandidates: string[];
  /** 経営者が考える価値のある問いの提案（Decisionは変更しない） */
  strategicQuestions: string[];
}

/** Insight Ranking（§23）: Impact/Urgency/Confidence/Actionabilityで評価し低価値を捨てる */
export function rankInsights(insights: string[]): RankedInsight[] {
  return insights
    .map((text) => {
      const impact = /粗利|資金|売上|受注/.test(text) ? 0.9 : 0.5;
      const urgency = /超過|遅延|未対応|集中/.test(text) ? 0.8 : 0.4;
      const confidence = /\d+件/.test(text) ? 0.8 : 0.5; // 件数根拠あり
      const actionability = /再分析|確認|更新|検討/.test(text) ? 0.8 : 0.4;
      const score = impact * 0.4 + urgency * 0.2 + confidence * 0.2 + actionability * 0.2;
      return { text, impact, urgency, confidence, actionability, score };
    })
    .filter((insight) => insight.score >= 0.5)
    .sort((a, b) => b.score - a.score);
}

/** 経営者向けの問いの提案（§24）。Decisionを勝手に変更しない */
export function proposeStrategicQuestions(dataset: CommandDataset, insights: string[]): string[] {
  const questions: string[] = [];
  if (insights.some((s) => /粗利|超過/.test(s))) {
    questions.push(
      '売上を増やすより、粗利の低い案件を減らした方が利益改善額が大きい可能性があります。比較しますか？'
    );
  }
  const unlinkedReports = dataset.dailyReports.filter((r) => !r.projectId).length;
  if (unlinkedReports > 0 || dataset.assignments.length > dataset.dailyReports.length * 2) {
    questions.push(
      '配置の問題は配置作成ではなく、受注時点の人員計画の問題かもしれません。分析しますか？'
    );
  }
  return questions;
}

/** 複数LESSONの共通パターンからPLAYBOOK候補を作る（§26-27。PENDING_REVIEWで保存） */
export async function extractPlaybookCandidates(
  service: MemoryService,
  memories: MemoryRecord[],
  companyId: string,
  now: string
): Promise<string[]> {
  const lessons = memories.filter((m) => m.type === 'LESSON' && m.status === 'ACTIVE');
  const created: string[] = [];
  for (let i = 0; i < lessons.length; i += 1) {
    for (let j = i + 1; j < lessons.length; j += 1) {
      if (similarity(lessons[i].statement, lessons[j].statement) >= 0.35) {
        const statement = `Playbook候補: ${lessons[i].statement.slice(0, 80)}（複数回有効と確認）`;
        try {
          const saved = await service.save(
            {
              type: 'PLAYBOOK',
              statement,
              entities: lessons[i].entities,
              relations: [
                { kind: 'validates', targetMemoryId: lessons[i].memoryId },
                { kind: 'validates', targetMemoryId: lessons[j].memoryId }
              ],
              layer: 'COMPANY',
              sensitivity: 'NORMAL',
              companyId,
              source: 'SYSTEM',
              sourceId: 'maintenance',
              validFrom: now.slice(0, 10),
              confidence: 'MEDIUM',
              createdBy: 'ai:maintenance',
              reviewStatus: 'PENDING_REVIEW',
              evidence: [
                {
                  label: '根拠Lesson',
                  value: lessons[i].statement.slice(0, 80),
                  source: 'Memory',
                  asOf: now
                },
                {
                  label: '根拠Lesson',
                  value: lessons[j].statement.slice(0, 80),
                  source: 'Memory',
                  asOf: now
                }
              ]
            },
            now
          );
          if (!saved.mergedIntoExisting) created.push(saved.record.statement);
        } catch {
          // Learning Safety違反は候補化しない
        }
      }
    }
  }
  return created;
}

/** 確定Decisionの一貫パターンからPrinciple候補を抽出（§28。ユーザー承認で格上げ） */
export async function extractPrincipleCandidates(
  service: MemoryService,
  memories: MemoryRecord[],
  companyId: string,
  now: string
): Promise<string[]> {
  const decisions = memories.filter(
    (m) => m.type === 'DECISION' && m.reviewStatus === 'CONFIRMED_BY_USER'
  );
  const themes: Array<{ pattern: RegExp; principle: string }> = [
    { pattern: /早|即|速|今日中/, principle: '速度優先（判断・対応は先送りしない）' },
    { pattern: /転記|二重|正本/, principle: '正本は1つ・転記を作らない' },
    { pattern: /任せ|移譲|担当/, principle: '社長判断を必要最小限にする（権限移譲）' }
  ];
  const created: string[] = [];
  for (const theme of themes) {
    const matched = decisions.filter((d) => theme.pattern.test(d.statement));
    if (matched.length >= 3) {
      try {
        const saved = await service.save(
          {
            type: 'PRINCIPLE',
            statement: `Principle候補: ${theme.principle}`,
            entities: [],
            relations: matched
              .slice(0, 3)
              .map((d) => ({ kind: 'relatesTo' as const, targetMemoryId: d.memoryId })),
            layer: 'PRESIDENT',
            sensitivity: 'NORMAL',
            companyId,
            source: 'SYSTEM',
            sourceId: 'maintenance',
            validFrom: now.slice(0, 10),
            confidence: 'MEDIUM',
            createdBy: 'ai:maintenance',
            reviewStatus: 'PENDING_REVIEW',
            evidence: matched.slice(0, 3).map((d) => ({
              label: '根拠Decision',
              value: d.statement.slice(0, 80),
              source: 'Memory',
              asOf: now
            }))
          },
          now
        );
        if (!saved.mergedIntoExisting) created.push(saved.record.statement);
      } catch {
        // 候補化失敗は無視（次回再評価）
      }
    }
  }
  return created;
}

/** 日々のデータから反復問題・矛盾・期限切れを検出する（重要なものだけ提案） */
export function discoverProblems(dataset: CommandDataset, scope: CompanyScope): string[] {
  const insights: string[] = [];
  const margins = dataset.projects
    .filter((p) => (p.orderAmount ?? 0) > 0 && (scope === 'group' || p.companyId === scope))
    .map((p) => computeProjectMargin(dataset, p))
    .filter((m) => m.forecastMarginRate !== null);
  const lowMargin = margins.filter(
    (m) => (m.forecastMarginRate as number) < (m.plannedMarginRate ?? 0) - 0.03
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
    proactiveInsights: dataset ? discoverProblems(dataset, 'group') : [],
    rankedInsights: [],
    playbookCandidates: [],
    principleCandidates: [],
    strategicQuestions: []
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

  // Insight Ranking + 問いの提案 + Playbook/Principle候補
  report.rankedInsights = rankInsights(report.proactiveInsights);
  if (dataset) {
    report.strategicQuestions = proposeStrategicQuestions(dataset, report.proactiveInsights);
    const service = new MemoryService(repository);
    const companyId = dataset.companies[0]?.companyId ?? 'group';
    report.playbookCandidates = await extractPlaybookCandidates(service, memories, companyId, asOf);
    report.principleCandidates = await extractPrincipleCandidates(
      service,
      memories,
      companyId,
      asOf
    );
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
    experimentId: `exp-${now.slice(0, 10)}-${expSeq++}-${persistentUuid()}`,
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
