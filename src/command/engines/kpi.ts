/**
 * 経営KPIスナップショット。トップ画面上部に出す最低限のKPIを、
 * 鮮度（最終更新＋FreshnessStatus）とData Confidence付きで返す。
 * ソース未接続・全欠損時は dataStatus=DATA_UNAVAILABLE とし、値を断定しない。
 */
import type {
  CommandAlert,
  CompanyScope,
  Freshness,
  FreshnessStatus,
  KpiSnapshot,
  KpiValue
} from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { datasetAvailability } from '../sources/SourceAdapter.js';
import { computeCashForecast, horizonBalance } from './cashForecast.js';
import { checkInvoices } from './invoiceChecks.js';
import { computeOverallForecastMarginRate } from './margin.js';
import { computeSalesSummary } from './sales.js';
import { detectSalesLeaks } from './salesLeak.js';
import { activeAlerts } from './alerts.js';

/** 汎用の鮮度ステータス判定。当日=FRESH / 2日以内=STALE / それ超=VERY_STALE */
export function freshnessStatusOf(freshness: Freshness | null, asOf: string): FreshnessStatus {
  if (!freshness || !freshness.lastUpdatedAt) return 'UNKNOWN';
  const ageDays = (Date.parse(asOf) - Date.parse(freshness.lastUpdatedAt)) / 86_400_000;
  if (Number.isNaN(ageDays)) return 'UNKNOWN';
  if (ageDays <= 1) return 'FRESH';
  if (ageDays <= 2) return 'STALE';
  return 'VERY_STALE';
}

export function computeKpiSnapshot(
  dataset: CommandDataset,
  scope: CompanyScope,
  alerts: CommandAlert[] = []
): KpiSnapshot {
  const dataStatus = datasetAvailability(dataset);
  if (dataStatus === 'DATA_UNAVAILABLE') {
    // ソースが全て未接続/エラーの場合、KPI値を出さない（0やデモ値で埋めない）
    return { scope, asOf: dataset.asOf, dataStatus, kpis: [] };
  }

  const cash = computeCashForecast(dataset, scope);
  const sales = computeSalesSummary(dataset, scope);
  const invoiceCheck = checkInvoices(dataset, scope);
  const leaks = detectSalesLeaks(dataset, scope);
  const marginRate = computeOverallForecastMarginRate(dataset, scope);
  const criticalCount = activeAlerts(alerts).filter(
    (alert) => alert.severity === 'CRITICAL' || alert.severity === 'WARNING'
  ).length;

  const nowFresh: Freshness = {
    lastUpdatedAt: dataset.asOf,
    source: 'LCC COMMAND 決定論ロジック',
    stale: false
  };
  const kpi = (
    key: string,
    label: string,
    value: number,
    unit: KpiValue['unit'],
    freshness: Freshness,
    confidence: KpiValue['confidence']
  ): KpiValue => ({
    key,
    label,
    value,
    unit,
    freshness,
    freshnessStatus: freshnessStatusOf(freshness, dataset.asOf),
    confidence
  });

  const kpis: KpiValue[] = [
    kpi(
      'cash_balance',
      '現預金',
      cash.currentBalance,
      'yen',
      cash.freshness,
      cash.balanceKnown ? (cash.freshnessStatus === 'FRESH' ? 'HIGH' : 'MEDIUM') : 'UNKNOWN'
    ),
    kpi(
      'cash_30d',
      '30日後現金予測',
      horizonBalance(cash, 30),
      'yen',
      nowFresh,
      cash.balanceKnown ? 'MEDIUM' : 'UNKNOWN'
    ),
    kpi('sales_month', '当月売上', sales.confirmedSales, 'yen', nowFresh, 'HIGH'),
    kpi('sales_landing', '売上着地予測', sales.landingForecast, 'yen', nowFresh, 'MEDIUM'),
    kpi('order_backlog', '受注残', sales.orderBacklog, 'yen', nowFresh, 'HIGH'),
    kpi(
      'margin_forecast',
      '全社予測粗利率',
      marginRate === null ? 0 : Math.round(marginRate * 1000) / 10,
      'percent',
      nowFresh,
      marginRate === null ? 'UNKNOWN' : 'MEDIUM'
    ),
    kpi(
      'uninvoiced',
      '完工未請求額',
      invoiceCheck.uninvoicedCompletedTotal,
      'yen',
      nowFresh,
      'HIGH'
    ),
    kpi('sales_actions', '営業要対応件数', leaks.length, 'count', nowFresh, 'HIGH'),
    kpi('alerts_today', '本日の重大アラート件数', criticalCount, 'count', nowFresh, 'HIGH')
  ];

  return { scope, asOf: dataset.asOf, dataStatus, kpis };
}
