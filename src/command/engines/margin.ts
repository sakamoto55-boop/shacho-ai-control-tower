/**
 * 案件粗利エンジン。予定粗利・予測粗利・実績粗利を分離して計算し、
 * 見積時との差異（何が粗利を悪化させたか）をカテゴリ別に検出する。
 * 計算はすべて決定論的。AIは結果の説明のみを担う。
 */
import type {
  CompanyScope,
  CostCategory,
  Evidence,
  Project,
  ProjectMargin
} from '../domain/types.js';
import { COST_CATEGORY_LABELS } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';

const ALL_CATEGORIES: CostCategory[] = [
  'labor',
  'subcontract',
  'disposal',
  'material',
  'vehicle',
  'machine',
  'transport',
  'other'
];

export function computeProjectMargin(dataset: CommandDataset, project: Project): ProjectMargin {
  const costs = dataset.costs.filter((cost) => cost.projectId === project.projectId);

  const costByCategory = {} as ProjectMargin['costByCategory'];
  for (const category of ALL_CATEGORIES) {
    costByCategory[category] = { planned: 0, forecastAndActual: 0 };
  }
  let plannedCost = 0;
  let forecastCost = 0;
  let actualCost = 0;
  for (const cost of costs) {
    if (cost.kind === 'planned') {
      plannedCost += cost.amount;
      costByCategory[cost.category].planned += cost.amount;
    } else {
      costByCategory[cost.category].forecastAndActual += cost.amount;
      if (cost.kind === 'actual') actualCost += cost.amount;
      else forecastCost += cost.amount;
    }
  }

  const totalForecast = actualCost + forecastCost;
  const hasAmount = project.orderAmount > 0;
  const forecastMarginRate =
    hasAmount && totalForecast > 0
      ? (project.orderAmount - totalForecast) / project.orderAmount
      : null;
  // 実績粗利は完工後（forecast原価が残っていない場合）のみ確定させる
  const isFinal = ['completed', 'invoiced', 'paid'].includes(project.stage) && forecastCost === 0;
  const actualMarginRate =
    hasAmount && isFinal && actualCost > 0
      ? (project.orderAmount - actualCost) / project.orderAmount
      : null;

  const varianceDrivers = ALL_CATEGORIES.map((category) => ({
    category,
    label: COST_CATEGORY_LABELS[category],
    diff: costByCategory[category].forecastAndActual - costByCategory[category].planned
  }))
    .filter((driver) => driver.diff > 0)
    .sort((a, b) => b.diff - a.diff);

  const evidence: Evidence[] = [
    {
      label: '受注額',
      value: `${project.orderAmount.toLocaleString()}円`,
      refId: project.projectId,
      source: '案件台帳',
      asOf: project.updatedAt
    },
    {
      label: '予定原価（見積時）',
      value: `${plannedCost.toLocaleString()}円`,
      refId: project.projectId,
      source: '見積内訳',
      asOf: project.updatedAt
    },
    {
      label: '発生済み原価',
      value: `${actualCost.toLocaleString()}円`,
      refId: project.projectId,
      source: '原価管理',
      asOf: project.updatedAt
    },
    {
      label: '残り予測原価',
      value: `${forecastCost.toLocaleString()}円`,
      refId: project.projectId,
      source: '原価管理',
      asOf: project.updatedAt
    },
    {
      label: '計算式',
      value: '予測粗利率 =（受注額 −（発生済み原価＋残り予測原価））÷ 受注額',
      source: 'LCC COMMAND 決定論ロジック',
      asOf: dataset.asOf
    }
  ];

  return {
    projectId: project.projectId,
    projectName: project.name,
    companyId: project.companyId,
    orderAmount: project.orderAmount,
    plannedMarginRate: project.plannedMarginRate,
    forecastMarginRate,
    actualMarginRate,
    plannedCost,
    forecastCost: totalForecast,
    actualCost,
    costByCategory,
    varianceDrivers,
    freshness: { lastUpdatedAt: project.updatedAt, source: '原価管理', stale: false },
    evidence
  };
}

export interface MarginDeterioration {
  margin: ProjectMargin;
  /** 予定粗利率との差（マイナス＝悪化幅、0-1） */
  drop: number;
}

/** 予定より粗利が悪化している進行中案件を悪化幅の大きい順に返す */
export function findMarginDeteriorations(
  dataset: CommandDataset,
  scope: CompanyScope,
  dropThreshold = 0.03
): MarginDeterioration[] {
  const scoped = filterDatasetByScope(dataset, scope);
  return scoped.projects
    .filter(
      (project) =>
        project.orderAmount > 0 &&
        !['inquiry', 'survey', 'estimating', 'following', 'lost'].includes(project.stage)
    )
    .map((project) => computeProjectMargin(dataset, project))
    .filter((margin) => margin.forecastMarginRate !== null)
    .map((margin) => ({
      margin,
      drop: margin.plannedMarginRate - (margin.forecastMarginRate as number)
    }))
    .filter((item) => item.drop >= dropThreshold)
    .sort((a, b) => b.drop - a.drop);
}

/** スコープ全体の予測粗利率（受注額加重平均） */
export function computeOverallForecastMarginRate(
  dataset: CommandDataset,
  scope: CompanyScope
): number | null {
  const scoped = filterDatasetByScope(dataset, scope);
  const margins = scoped.projects
    .filter(
      (project) =>
        project.orderAmount > 0 &&
        !['inquiry', 'survey', 'estimating', 'following', 'lost'].includes(project.stage)
    )
    .map((project) => computeProjectMargin(dataset, project))
    .filter((margin) => margin.forecastMarginRate !== null || margin.actualMarginRate !== null);
  const totalAmount = margins.reduce((sum, margin) => sum + margin.orderAmount, 0);
  if (totalAmount === 0) return null;
  const totalProfit = margins.reduce(
    (sum, margin) =>
      sum + margin.orderAmount * ((margin.actualMarginRate ?? margin.forecastMarginRate) as number),
    0
  );
  return totalProfit / totalAmount;
}
