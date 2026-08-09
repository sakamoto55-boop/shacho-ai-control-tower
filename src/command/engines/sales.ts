/**
 * 売上・受注・営業サマリエンジン（決定論的）。
 * 当月確定売上、着地予測、目標比、受注残、見積提出済パイプラインを計算する。
 */
import type { CompanyScope, Evidence } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { shiftDate } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';
import { jstMonth } from '../utils/jst.js';

export interface PipelineItem {
  projectId: string;
  projectName: string;
  customerName: string;
  amount: number;
  probability: number;
  submittedAt: string;
  lastInteractionAt: string | null;
}

export interface SalesSummary {
  scope: CompanyScope;
  month: string;
  target: number | null;
  /** 当月に完工・請求・入金済み案件の合計（確定売上） */
  confirmedSales: number;
  /** 確定売上＋当月完工予定の施工中案件（着地予測）。金額確認済0件（カバレッジ0%）ならnull=算出不能 */
  landingForecast: number | null;
  /** 目標比（着地予測 ÷ 目標 − 1）。目標未設定・着地算出不能時は null */
  targetGapRate: number | null;
  shortfall: number | null;
  /** 受注残（金額確認済分のみの合計）。金額確認済0件ならnull=算出不能（0円と表示しない） */
  orderBacklog: number | null;
  /** §検収4: 受注扱い件数と金額カバレッジ（合計金額を全体と誤認させないため必ず併記する） */
  orderedCount: number;
  amountKnownCount: number;
  amountUnknownCount: number;
  /** 金額確認済 ÷ 受注扱い（%） */
  coverageRate: number;
  /** 確定売上・着地のうち金額不明で合計に含められなかった件数 */
  confirmedUnknownAmountCount: number;
  landingUnknownAmountCount: number;
  /** 期日超過のまま未完工の件数（当月着地には含めない） */
  overdueUnfinishedCount: number;
  /** 会計・請求ソースの接続状態。未接続時、確定売上は「判定不能（完工案件ベース参考値）」 */
  accountingConnected: boolean;
  /** 見積提出済みで受注可能性のある案件（受注確度降順） */
  pipeline: PipelineItem[];
  pipelineTotal: number;
  evidence: Evidence[];
}

export function computeSalesSummary(dataset: CommandDataset, scope: CompanyScope): SalesSummary {
  const scoped = filterDatasetByScope(dataset, scope);
  const month = jstMonth(dataset.asOf); // 月次締めはJST基準
  const monthEnd = `${month}-31`;

  const target =
    scoped.salesTargets.filter((t) => t.month === month).reduce((sum, t) => sum + t.amount, 0) ||
    null;

  const confirmedProjects = scoped.projects.filter(
    (project) =>
      ['completed', 'invoiced', 'paid'].includes(project.stage) &&
      project.completedDate !== undefined &&
      project.completedDate.startsWith(month)
  );
  // 契約額不明（null）は合計に含めず件数として分離（不明→0円変換をしない）
  const confirmedKnown = confirmedProjects.filter((project) => project.orderAmount !== null);
  const confirmedSales = confirmedKnown.reduce((sum, project) => sum + (project.orderAmount as number), 0);
  const confirmedUnknownAmountCount = confirmedProjects.length - confirmedKnown.length;

  // §検収4: 当月着地は当月完工予定のみ（前月期日の未完工案件を当月へ混入させない）
  const monthStart = `${month}-01`;
  const landingProjects = scoped.projects.filter(
    (project) =>
      ['ordered', 'in_progress'].includes(project.stage) &&
      project.dueDate !== undefined &&
      project.dueDate >= monthStart &&
      project.dueDate <= monthEnd
  );
  const landingKnown = landingProjects.filter((project) => project.orderAmount !== null);
  const landingKnownTotal =
    confirmedSales + landingKnown.reduce((sum, project) => sum + (project.orderAmount as number), 0);
  const landingUnknownAmountCount = landingProjects.length - landingKnown.length;
  const overdueUnfinishedCount = scoped.projects.filter(
    (project) =>
      ['ordered', 'in_progress'].includes(project.stage) &&
      project.dueDate !== undefined &&
      project.dueDate < monthStart
  ).length;

  const orderedAll = scoped.projects.filter((project) =>
    ['ordered', 'in_progress'].includes(project.stage)
  );
  const amountKnown = orderedAll.filter(
    (project) => project.orderAmount !== null && project.orderAmount > 0
  );
  const orderedCount = orderedAll.length;
  const amountKnownCount = amountKnown.length;
  const amountUnknownCount = orderedCount - amountKnownCount;
  const coverageRate = orderedCount > 0 ? Math.round((amountKnownCount / orderedCount) * 1000) / 10 : 100;

  // §検収5-3: 金額確認済0件（カバレッジ0%）では合計を作らない（0円=実態と誤認させない）
  const amountsComputable = orderedCount === 0 || amountKnownCount > 0;
  const orderBacklog = amountsComputable
    ? amountKnown.reduce((sum, project) => sum + (project.orderAmount as number), 0)
    : null;
  const landingForecast = amountsComputable ? landingKnownTotal : null;
  const targetGapRate = target && landingForecast !== null ? landingForecast / target - 1 : null;
  const shortfall = target && landingForecast !== null ? Math.max(0, target - landingForecast) : null;
  const invoiceSource = dataset.meta.sources.find((src) => src.sourceName === 'InvoiceSource');
  const accountingConnected = Boolean(invoiceSource && !invoiceSource.errorState);

  const pipeline: PipelineItem[] = scoped.estimates
    .filter((estimate) => estimate.status === 'submitted')
    .map((estimate) => {
      const project = scoped.projects.find((p) => p.projectId === estimate.projectId);
      const customer = scoped.customers.find((c) => c.customerId === project?.customerId);
      const lastInteraction = scoped.interactions
        .filter((interaction) => interaction.projectId === estimate.projectId)
        .sort((a, b) => b.datetime.localeCompare(a.datetime))[0];
      return {
        projectId: estimate.projectId,
        projectName: project?.name ?? estimate.projectId,
        customerName: customer?.name ?? '不明',
        amount: estimate.amount,
        probability: estimate.probability ?? 0,
        submittedAt: estimate.submittedAt ?? '',
        lastInteractionAt: lastInteraction?.datetime ?? null
      };
    })
    .sort((a, b) => b.probability - a.probability || b.amount - a.amount);
  const pipelineTotal = pipeline.reduce((sum, item) => sum + item.amount, 0);

  const evidence: Evidence[] = [
    ...(target
      ? [
          {
            label: `${month} 売上目標`,
            value: `${target.toLocaleString()}円`,
            source: '経営計画（設定値）',
            asOf: dataset.asOf
          }
        ]
      : []),
    ...confirmedProjects.map((project) => ({
      label: `確定売上 ${project.name}`,
      value: `${project.orderAmount !== null ? `${project.orderAmount.toLocaleString()}円` : '金額不明'}（完工 ${project.completedDate}）`,
      refId: project.projectId,
      source: '案件台帳',
      asOf: project.updatedAt
    })),
    ...landingProjects.map((project) => ({
      label: `当月完工予定 ${project.name}`,
      value: `${project.orderAmount !== null ? `${project.orderAmount.toLocaleString()}円` : '金額不明'}（完工予定 ${project.dueDate}）`,
      refId: project.projectId,
      source: '案件台帳',
      asOf: project.updatedAt
    }))
  ];

  return {
    scope,
    month,
    target,
    confirmedSales,
    landingForecast,
    targetGapRate,
    shortfall,
    orderBacklog,
    orderedCount,
    amountKnownCount,
    amountUnknownCount,
    coverageRate,
    confirmedUnknownAmountCount,
    landingUnknownAmountCount,
    overdueUnfinishedCount,
    accountingConnected,
    pipeline,
    pipelineTotal,
    evidence
  };
}

/** 来月以降の完工予定＋パイプラインから「来月仕事が足りるか」の材料を返す */
export function computeNextMonthOutlook(dataset: CommandDataset, scope: CompanyScope) {
  const scoped = filterDatasetByScope(dataset, scope);
  const monthEnd = `${jstMonth(dataset.asOf)}-31`;
  const nextMonthStart = shiftDate(`${monthEnd}T00:00:00.000Z`, 1);
  const scheduled = scoped.projects.filter(
    (project) =>
      ['ordered', 'in_progress'].includes(project.stage) &&
      (project.dueDate === undefined || project.dueDate >= nextMonthStart)
  );
  return {
    scheduledAmount: scheduled.reduce((sum, project) => sum + (project.orderAmount ?? 0), 0),
    scheduledProjects: scheduled,
    pipeline: computeSalesSummary(dataset, scope).pipeline
  };
}
