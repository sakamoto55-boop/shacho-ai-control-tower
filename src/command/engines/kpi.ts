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
  // §検収5-5: ProjectSource由来KPIの鮮度は取得時刻ではなくSource側レコードの実更新時刻で判定する
  const latestProjectUpdate = dataset.projects.reduce<string | null>(
    (latest, p) =>
      p.sourceRecordUpdatedAt && (!latest || p.sourceRecordUpdatedAt > latest)
        ? p.sourceRecordUpdatedAt
        : latest,
    null
  );
  const projectSyncedAt = dataset.projects.reduce<string | null>(
    (latest, p) => (p.snapshotFetchedAt && (!latest || p.snapshotFetchedAt > latest) ? p.snapshotFetchedAt : latest),
    null
  );
  const projectFresh: Freshness = {
    lastUpdatedAt: latestProjectUpdate ?? '',
    source: '案件台帳（Source側レコード最終更新）',
    stale: latestProjectUpdate !== null && freshnessStatusOf({ lastUpdatedAt: latestProjectUpdate, source: '', stale: false }, dataset.asOf) !== 'FRESH'
  };
  const kpi = (
    key: string,
    label: string,
    value: number | null,
    unit: KpiValue['unit'],
    freshness: Freshness,
    confidence: KpiValue['confidence'],
    syncedAt?: string
  ): KpiValue => ({
    key,
    label,
    value,
    unit,
    freshness,
    freshnessStatus: freshnessStatusOf(freshness, dataset.asOf),
    ...(syncedAt ? { syncedAt } : {}),
    confidence
  });
  const projectSynced = projectSyncedAt ?? dataset.asOf;

  // §検収5-6: PROVISIONAL status由来の営業対応は「候補」であり確定件数として扱わない
  const provisionalLeaks = leaks.filter((leak) => leak.provisional).length;
  const allLeaksProvisional = leaks.length > 0 && provisionalLeaks === leaks.length;

  const kpis: KpiValue[] = [
    // §検収4-1: 銀行未接続の現預金・現金予測はnull（0円表示させない）
    kpi(
      'cash_balance',
      '現預金',
      cash.balanceKnown ? cash.currentBalance : null,
      'yen',
      cash.freshness,
      cash.balanceKnown ? (cash.freshnessStatus === 'FRESH' ? 'HIGH' : 'MEDIUM') : 'UNKNOWN'
    ),
    kpi(
      'cash_30d',
      '30日後現金予測',
      cash.balanceKnown ? horizonBalance(cash, 30) : null,
      'yen',
      nowFresh,
      cash.balanceKnown ? 'MEDIUM' : 'UNKNOWN'
    ),
    // §検収7: 会計/請求未接続の確定売上はnull+UNKNOWN（0円表示させない）
    kpi(
      'sales_month',
      '当月売上',
      sales.accountingConnected ? sales.confirmedSales : null,
      'yen',
      projectFresh,
      sales.accountingConnected ? 'HIGH' : 'UNKNOWN',
      projectSynced
    ),
    // 着地は金額確認済0件なら算出不能（null）。1件以上・低カバレッジはLOW（参考値）
    kpi(
      'sales_landing',
      sales.landingForecast === null
        ? `売上着地予測（算出不能・金額確認済${sales.amountKnownCount}/${sales.orderedCount}件・カバレッジ${sales.coverageRate}%）`
        : sales.coverageRate < 50
          ? '売上着地予測（確認済金額ベース参考値）'
          : '売上着地予測',
      sales.landingForecast,
      'yen',
      projectFresh,
      sales.landingForecast === null ? 'UNKNOWN' : sales.coverageRate < 50 ? 'LOW' : 'MEDIUM',
      projectSynced
    ),
    // 受注残はカバレッジ必須表示。金額確認済0件なら総額null=算出不能
    kpi(
      'order_backlog',
      `受注残（金額確認済${sales.amountKnownCount}/${sales.orderedCount}件・カバレッジ${sales.coverageRate}%）`,
      sales.orderBacklog,
      'yen',
      projectFresh,
      sales.orderBacklog === null ? 'UNKNOWN' : sales.coverageRate < 50 ? 'LOW' : 'HIGH',
      projectSynced
    ),
    // §検収4-4: 粗利率不明はnull（0%を入れない）
    kpi(
      'margin_forecast',
      '全社予測粗利率',
      marginRate === null ? null : Math.round(marginRate * 1000) / 10,
      'percent',
      projectFresh,
      marginRate === null ? 'UNKNOWN' : 'MEDIUM',
      projectSynced
    ),
    kpi(
      'uninvoiced',
      '完工未請求額',
      invoiceCheck.invoicesConnected ? invoiceCheck.uninvoicedCompletedTotal : null,
      'yen',
      projectFresh,
      invoiceCheck.invoicesConnected ? 'HIGH' : 'UNKNOWN',
      projectSynced
    ),
    kpi(
      'sales_actions',
      allLeaksProvisional
        ? `次工程未設定候補件数（status=contractの意味確認待ち）`
        : provisionalLeaks > 0
          ? `営業要対応件数（うち確認待ち候補${provisionalLeaks}件）`
          : '営業要対応件数',
      leaks.length,
      'count',
      projectFresh,
      allLeaksProvisional ? 'MEDIUM' : 'HIGH',
      projectSynced
    ),
    kpi('alerts_today', '本日の重大アラート件数', criticalCount, 'count', nowFresh, 'HIGH')
  ];

  return { scope, asOf: dataset.asOf, dataStatus, kpis };
}
