/**
 * 営業漏れ検知エンジン。
 * 閾値は設定変更可能。毎朝「売上につながる可能性が高い行動」を優先順位付きで出す。
 */
import type { AlertKind, CompanyScope, Evidence } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';

export interface SalesLeakThresholds {
  /** 問い合わせ未対応とみなす経過時間（時間） */
  inquiryHours: number;
  /** 現調後、見積未提出とみなす経過日数 */
  estimateDays: number;
  /** 見積提出後、追客なしとみなす経過日数 */
  followUpDays: number;
  /** 停滞とみなす経過日数 */
  stalledDays: number;
}

export const DEFAULT_LEAK_THRESHOLDS: SalesLeakThresholds = {
  inquiryHours: 24,
  estimateDays: 5,
  followUpDays: 7,
  stalledDays: 30
};

export interface SalesLeak {
  kind: AlertKind;
  projectId: string;
  projectName: string;
  customerName: string;
  title: string;
  detail: string;
  /** 優先順位付け用スコア（大きいほど優先） */
  score: number;
  evidence: Evidence[];
}

function hoursSince(asOf: string, iso: string): number {
  return (Date.parse(asOf) - Date.parse(iso)) / 3_600_000;
}

function daysSince(asOf: string, isoOrDate: string): number {
  const iso = isoOrDate.length === 10 ? `${isoOrDate}T00:00:00.000Z` : isoOrDate;
  return hoursSince(asOf, iso) / 24;
}

export function detectSalesLeaks(
  dataset: CommandDataset,
  scope: CompanyScope,
  thresholds: SalesLeakThresholds = DEFAULT_LEAK_THRESHOLDS
): SalesLeak[] {
  const scoped = filterDatasetByScope(dataset, scope);
  const leaks: SalesLeak[] = [];

  const customerName = (customerId: string) =>
    scoped.customers.find((c) => c.customerId === customerId)?.name ?? '不明';
  const lastInteraction = (projectId: string) =>
    scoped.interactions
      .filter((interaction) => interaction.projectId === projectId)
      .sort((a, b) => b.datetime.localeCompare(a.datetime))[0];

  for (const project of scoped.projects) {
    const interaction = lastInteraction(project.projectId);
    const evidenceBase: Evidence[] = [
      {
        label: '案件ステージ',
        value: project.stage,
        refId: project.projectId,
        source: '案件台帳',
        asOf: project.updatedAt
      },
      ...(interaction
        ? [
            {
              label: '最終接点',
              value: `${interaction.datetime}（${interaction.summary}）`,
              refId: interaction.interactionId,
              source: '営業接点記録',
              asOf: interaction.datetime
            }
          ]
        : [])
    ];

    // 問い合わせ24時間未対応
    if (project.stage === 'inquiry') {
      const receivedAt = interaction?.datetime ?? project.updatedAt;
      const hours = hoursSince(dataset.asOf, receivedAt);
      if (hours >= thresholds.inquiryHours) {
        leaks.push({
          kind: 'inquiry_unanswered',
          projectId: project.projectId,
          projectName: project.name,
          customerName: customerName(project.customerId),
          title: `問い合わせ${Math.floor(hours)}時間未対応`,
          detail: `${customerName(project.customerId)}からの問い合わせに${Math.floor(hours)}時間対応記録がありません。`,
          score: 100 + hours,
          evidence: evidenceBase
        });
      }
    }

    // 現調後見積未提出
    if (['survey', 'estimating'].includes(project.stage)) {
      const hasSubmitted = scoped.estimates.some(
        (estimate) => estimate.projectId === project.projectId && estimate.submittedAt
      );
      const days = daysSince(dataset.asOf, project.updatedAt);
      if (!hasSubmitted && days >= thresholds.estimateDays) {
        leaks.push({
          kind: 'estimate_not_submitted',
          projectId: project.projectId,
          projectName: project.name,
          customerName: customerName(project.customerId),
          title: `現調後${Math.floor(days)}日、見積未提出`,
          detail: `${project.name}は現調後${Math.floor(days)}日経過していますが見積が提出されていません。`,
          score: 80 + days,
          evidence: evidenceBase
        });
      }
    }

    // 見積提出後の追客なし / 30日以上停滞
    if (project.stage === 'following') {
      const estimate = scoped.estimates.find(
        (item) => item.projectId === project.projectId && item.submittedAt
      );
      const lastTouch =
        interaction?.datetime ??
        (estimate?.submittedAt ? `${estimate.submittedAt}T00:00:00.000Z` : project.updatedAt);
      const days = daysSince(dataset.asOf, lastTouch);
      if (days >= thresholds.stalledDays) {
        leaks.push({
          kind: 'stalled',
          projectId: project.projectId,
          projectName: project.name,
          customerName: customerName(project.customerId),
          title: `${Math.floor(days)}日停滞`,
          detail: `${project.name}は最終接点から${Math.floor(days)}日経過しています。継続可否の判断が必要です。`,
          score: 40 + days / 10,
          evidence: evidenceBase
        });
      } else if (estimate && days >= thresholds.followUpDays) {
        leaks.push({
          kind: 'no_follow_up',
          projectId: project.projectId,
          projectName: project.name,
          customerName: customerName(project.customerId),
          title: `見積提出後${Math.floor(days)}日追客なし`,
          detail: `${customerName(project.customerId)}へ見積${estimate.amount.toLocaleString()}円を提出後、${Math.floor(days)}日接点がありません。`,
          score: 60 + days + (estimate.probability ?? 0) * 20,
          evidence: evidenceBase
        });
      }
    }

    // 受注後次工程未設定
    if (project.stage === 'ordered' && !project.startDate) {
      const hasNextAction = interaction?.nextAction !== undefined;
      if (!hasNextAction) {
        leaks.push({
          kind: 'no_next_step',
          projectId: project.projectId,
          projectName: project.name,
          customerName: customerName(project.customerId),
          title: '受注後の次工程未設定',
          detail: `${project.name}（受注額${(project.orderAmount ?? 0).toLocaleString()}円）に着工日・次アクションが設定されていません。`,
          score: 70,
          evidence: evidenceBase
        });
      }
    }
  }

  return leaks.sort((a, b) => b.score - a.score);
}
