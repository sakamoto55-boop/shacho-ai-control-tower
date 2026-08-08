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
  /** 確定売上＋当月完工予定の施工中案件（着地予測） */
  landingForecast: number;
  /** 目標比（着地予測 ÷ 目標 − 1）。目標未設定時は null */
  targetGapRate: number | null;
  shortfall: number | null;
  /** 受注済み・施工中でまだ売上計上されていない金額（受注残） */
  orderBacklog: number;
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
  const confirmedSales = confirmedProjects.reduce((sum, project) => sum + project.orderAmount, 0);

  const landingProjects = scoped.projects.filter(
    (project) =>
      ['ordered', 'in_progress'].includes(project.stage) &&
      project.dueDate !== undefined &&
      project.dueDate <= monthEnd
  );
  const landingForecast =
    confirmedSales + landingProjects.reduce((sum, project) => sum + project.orderAmount, 0);

  const targetGapRate = target ? landingForecast / target - 1 : null;
  const shortfall = target ? Math.max(0, target - landingForecast) : null;

  const orderBacklog = scoped.projects
    .filter((project) => ['ordered', 'in_progress'].includes(project.stage))
    .reduce((sum, project) => sum + project.orderAmount, 0);

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
      value: `${project.orderAmount.toLocaleString()}円（完工 ${project.completedDate}）`,
      refId: project.projectId,
      source: '案件台帳',
      asOf: project.updatedAt
    })),
    ...landingProjects.map((project) => ({
      label: `当月完工予定 ${project.name}`,
      value: `${project.orderAmount.toLocaleString()}円（完工予定 ${project.dueDate}）`,
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
    scheduledAmount: scheduled.reduce((sum, project) => sum + project.orderAmount, 0),
    scheduledProjects: scheduled,
    pipeline: computeSalesSummary(dataset, scope).pipeline
  };
}
