/**
 * 社長Brief。毎朝自動生成し、単なる数字羅列ではなく
 * 「昨日から何が変わったか」「本日の判断事項」「AI推奨アクション」を優先する。
 */
import type { CommandAlert, CompanyScope, Decision, ExecutiveBrief } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { addDaysJst, jstDate } from '../utils/jst.js';
import { buildAlerts, activeAlerts } from '../engines/alerts.js';
import { computeCashForecast, horizonBalance } from '../engines/cashForecast.js';
import { computeKpiSnapshot } from '../engines/kpi.js';
import { detectSalesLeaks } from '../engines/salesLeak.js';
import { checkInvoices } from '../engines/invoiceChecks.js';
import { filterDatasetByScope, scopeLabel } from '../domain/scope.js';

export function yen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`;
}

/** 昨日以降に動いた事実（原価計上・入金・請求・接点）を変化点として列挙する */
function collectChangesSinceYesterday(dataset: CommandDataset, scope: CompanyScope): string[] {
  const scoped = filterDatasetByScope(dataset, scope);
  const yesterday = addDaysJst(jstDate(dataset.asOf), -1);
  const changes: string[] = [];

  for (const cost of scoped.costs.filter((c) => c.kind === 'actual' && c.date >= yesterday)) {
    const project = scoped.projects.find((p) => p.projectId === cost.projectId);
    changes.push(
      `${project?.name ?? cost.projectId}で原価${yen(cost.amount)}を計上${cost.note ? `（${cost.note}）` : ''}`
    );
  }
  for (const payment of scoped.payments.filter(
    (p) => p.direction === 'in' && p.date >= yesterday
  )) {
    changes.push(`入金${yen(payment.amount)}を確認${payment.note ? `（${payment.note}）` : ''}`);
  }
  for (const invoice of scoped.invoices.filter(
    (i) => i.issuedAt !== undefined && i.issuedAt >= yesterday
  )) {
    changes.push(`請求書${yen(invoice.amount)}を発行（${invoice.invoiceId}）`);
  }
  for (const interaction of scoped.interactions.filter(
    (i) => i.datetime >= `${yesterday}T00:00:00.000Z`
  )) {
    changes.push(`営業接点: ${interaction.summary}（${interaction.channel}）`);
  }
  return changes;
}

export function generateExecutiveBrief(
  dataset: CommandDataset,
  scope: CompanyScope,
  decisions: Decision[] = []
): ExecutiveBrief {
  const alerts = buildAlerts(dataset, scope, decisions);
  const visible = activeAlerts(alerts);
  const kpiSnapshot = computeKpiSnapshot(dataset, scope, alerts);
  const cash = computeCashForecast(dataset, scope);
  const leaks = detectSalesLeaks(dataset, scope);
  const invoiceCheck = checkInvoices(dataset, scope);

  const decisionsNeeded = visible
    .filter((alert) => alert.severity === 'CRITICAL' || alert.severity === 'WARNING')
    .slice(0, 5)
    .map((alert) => alert.title);

  const recommendedActions: string[] = [];
  if (leaks.length > 0) {
    recommendedActions.push(
      `営業要対応 ${leaks.length}件のうち最優先: ${leaks[0].title}（${leaks[0].customerName}）`
    );
  }
  if (invoiceCheck.uninvoicedCompletedTotal > 0) {
    recommendedActions.push(
      `完工未請求 ${yen(invoiceCheck.uninvoicedCompletedTotal)} の請求書発行`
    );
  }
  for (const alert of visible.filter((a) => a.kind === 'margin_drop').slice(0, 1)) {
    recommendedActions.push(`${alert.title.split(' の')[0]} の追加請求可能性の確認`);
  }

  const changes = collectChangesSinceYesterday(dataset, scope);
  const headline =
    decisionsNeeded.length > 0
      ? `本日は経営上${decisionsNeeded.length}件確認が必要です。`
      : '本日、即時の経営判断が必要な項目はありません。';

  const kpi = (key: string) => kpiSnapshot.kpis.find((item) => item.key === key)?.value ?? 0;
  const lines: string[] = [
    `おはようございます。${scopeLabel(dataset, scope)}の朝Briefです。`,
    '',
    headline,
    ...decisionsNeeded.map(
      (item, index) => `${['①', '②', '③', '④', '⑤'][index] ?? `${index + 1}.`}${item}`
    ),
    '',
    '【主要数値】',
    `現預金 ${yen(cash.currentBalance)}（${cash.freshness.source}）`,
    `現金予測 30日後${yen(horizonBalance(cash, 30))} / 60日後${yen(horizonBalance(cash, 60))} / 90日後${yen(horizonBalance(cash, 90))}`,
    `当月売上 ${yen(kpi('sales_month'))} / 着地予測 ${yen(kpi('sales_landing'))}`,
    `受注残 ${yen(kpi('order_backlog'))} / 全社予測粗利率 ${kpi('margin_forecast')}%`,
    `完工未請求 ${yen(invoiceCheck.uninvoicedCompletedTotal)} / 期日超過未入金 ${yen(invoiceCheck.overdueReceivableTotal)}`,
    '',
    '【昨日からの変化】',
    ...(changes.length > 0
      ? changes.map((change) => `・${change}`)
      : ['・記録された変化はありません']),
    '',
    '【AI推奨アクション】',
    ...(recommendedActions.length > 0
      ? recommendedActions.map((action) => `・${action}`)
      : ['・特になし'])
  ];

  const suppressed = alerts.filter((alert) => alert.suppressedByDecisionId);
  if (suppressed.length > 0) {
    lines.push(
      '',
      `※経営判断Memoryにより${suppressed.length}件の警告を表示していません（期限到来後に再評価します）。`
    );
  }

  return {
    scope,
    generatedAt: dataset.asOf,
    headline,
    changes,
    decisionsNeeded,
    recommendedActions,
    kpiSnapshot,
    alerts: visible,
    text: lines.join('\n')
  };
}

export type { CommandAlert };
