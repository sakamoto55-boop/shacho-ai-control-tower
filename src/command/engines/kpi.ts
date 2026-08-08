/**
 * 経営KPIスナップショット。トップ画面上部に出す最低限のKPIを、
 * 鮮度（最終更新）とData Confidence付きで返す。
 */
import type { CommandAlert, CompanyScope, KpiSnapshot, KpiValue } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { computeCashForecast, horizonBalance } from './cashForecast.js';
import { checkInvoices } from './invoiceChecks.js';
import { computeOverallForecastMarginRate } from './margin.js';
import { computeSalesSummary } from './sales.js';
import { detectSalesLeaks } from './salesLeak.js';
import { activeAlerts } from './alerts.js';

export function computeKpiSnapshot(
  dataset: CommandDataset,
  scope: CompanyScope,
  alerts: CommandAlert[] = []
): KpiSnapshot {
  const cash = computeCashForecast(dataset, scope);
  const sales = computeSalesSummary(dataset, scope);
  const invoiceCheck = checkInvoices(dataset, scope);
  const leaks = detectSalesLeaks(dataset, scope);
  const marginRate = computeOverallForecastMarginRate(dataset, scope);
  const criticalCount = activeAlerts(alerts).filter(
    (alert) => alert.severity === 'CRITICAL' || alert.severity === 'WARNING'
  ).length;

  const nowFresh = {
    lastUpdatedAt: dataset.asOf,
    source: 'LCC COMMAND 決定論ロジック',
    stale: false
  };
  const kpis: KpiValue[] = [
    {
      key: 'cash_balance',
      label: '現預金',
      value: cash.currentBalance,
      unit: 'yen',
      freshness: cash.freshness,
      confidence: cash.freshness.stale ? 'MEDIUM' : 'HIGH'
    },
    {
      key: 'cash_30d',
      label: '30日後現金予測',
      value: horizonBalance(cash, 30),
      unit: 'yen',
      freshness: nowFresh,
      confidence: 'MEDIUM'
    },
    {
      key: 'sales_month',
      label: '当月売上',
      value: sales.confirmedSales,
      unit: 'yen',
      freshness: nowFresh,
      confidence: 'HIGH'
    },
    {
      key: 'sales_landing',
      label: '売上着地予測',
      value: sales.landingForecast,
      unit: 'yen',
      freshness: nowFresh,
      confidence: 'MEDIUM'
    },
    {
      key: 'order_backlog',
      label: '受注残',
      value: sales.orderBacklog,
      unit: 'yen',
      freshness: nowFresh,
      confidence: 'HIGH'
    },
    {
      key: 'margin_forecast',
      label: '全社予測粗利率',
      value: marginRate === null ? 0 : Math.round(marginRate * 1000) / 10,
      unit: 'percent',
      freshness: nowFresh,
      confidence: marginRate === null ? 'UNKNOWN' : 'MEDIUM'
    },
    {
      key: 'uninvoiced',
      label: '完工未請求額',
      value: invoiceCheck.uninvoicedCompletedTotal,
      unit: 'yen',
      freshness: nowFresh,
      confidence: 'HIGH'
    },
    {
      key: 'sales_actions',
      label: '営業要対応件数',
      value: leaks.length,
      unit: 'count',
      freshness: nowFresh,
      confidence: 'HIGH'
    },
    {
      key: 'alerts_today',
      label: '本日の重大アラート件数',
      value: criticalCount,
      unit: 'count',
      freshness: nowFresh,
      confidence: 'HIGH'
    }
  ];

  return { scope, asOf: dataset.asOf, kpis };
}
