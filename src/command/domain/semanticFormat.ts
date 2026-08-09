/**
 * Semantic Formatter（検収是正4 §2）。
 * 現預金・売上・請求の「接続状態を確認してから文章を作る」ロジックを一元化し、
 * 単独回答・複合回答・朝Brief・Artifactのすべてで同じ意味表現を共有する。
 * ここを経由せずに yen(0) で未接続値を表示してはならない。
 */
import type { CashForecastResult } from './types.js';
import { horizonBalance } from '../engines/cashForecast.js';
import type { SalesSummary } from '../engines/sales.js';
import type { InvoiceCheckResult } from '../engines/invoiceChecks.js';

export function yenOrUnknown(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? '判定不能' : `${amount.toLocaleString('ja-JP')}円`;
}

/** 現預金。銀行未接続なら0円と混同させない */
export function formatCashStatus(cash: CashForecastResult): string {
  if (!cash.balanceKnown) return '現預金: 銀行未接続のため判定不能（0円ではありません）';
  return `現預金 ${yenOrUnknown(cash.currentBalance)}（${cash.freshness.source}）`;
}

/** 現金予測（30/60/90日）。残高不明なら予測も出さない */
export function formatCashForecastLine(cash: CashForecastResult): string {
  if (!cash.balanceKnown) return '現金予測: 銀行未接続のため判定不能';
  return `現金予測 30日後${yenOrUnknown(horizonBalance(cash, 30))} / 60日後${yenOrUnknown(horizonBalance(cash, 60))} / 90日後${yenOrUnknown(horizonBalance(cash, 90))}`;
}

/** 当月確定売上。会計・請求未接続なら判定不能（完工ベース参考値を併記） */
export function formatSalesMonthStatus(sales: SalesSummary): string {
  if (!sales.accountingConnected) {
    return `当月売上: 会計・請求Source未接続のため判定不能（完工案件ベース参考値 ${yenOrUnknown(sales.confirmedSales)}）`;
  }
  return `当月売上 ${yenOrUnknown(sales.confirmedSales)}`;
}

/** 着地予測。金額確認済0件なら算出不能。1件以上なら「確認済金額ベース参考値」 */
export function formatSalesLandingStatus(sales: SalesSummary): string {
  if (sales.landingForecast === null) {
    return `着地予測: 算出不能（金額確認済${sales.amountKnownCount}/${sales.orderedCount}件・カバレッジ${sales.coverageRate}%）`;
  }
  if (sales.coverageRate < 50) {
    return `着地予測（確認済金額ベース参考値） ${yenOrUnknown(sales.landingForecast)}（カバレッジ${sales.coverageRate}%）`;
  }
  return `着地予測 ${yenOrUnknown(sales.landingForecast)}`;
}

/** 受注残。金額確認済0件なら総額は算出不能（0円と表示しない） */
export function formatBacklogStatus(sales: SalesSummary): string {
  const coverage = `金額確認済${sales.amountKnownCount}/${sales.orderedCount}件・カバレッジ${sales.coverageRate}%`;
  if (sales.orderBacklog === null) return `受注残総額: 算出不能（${coverage}）`;
  return `受注残 ${yenOrUnknown(sales.orderBacklog)}（${coverage}）`;
}

/** 完工未請求・未入金。請求/入金Source未接続なら判定不能 */
export function formatInvoiceStatus(invoices: InvoiceCheckResult): string {
  if (!invoices.invoicesConnected) {
    return '完工未請求: 請求Source未接続のため判定不能（0円ではありません）';
  }
  const uninvoiced = `完工未請求 ${yenOrUnknown(invoices.uninvoicedCompletedTotal)}`;
  const receivable = invoices.paymentsConnected
    ? `期日超過未入金 ${yenOrUnknown(invoices.overdueReceivableTotal)}`
    : '未入金: 入金Source未接続のため判定不能';
  return `${uninvoiced} / ${receivable}`;
}

/** 全社予測粗利率。原価未接続なら0%を入れない */
export function formatMarginStatus(marginRatePercent: number | null): string {
  if (marginRatePercent === null) return '全社予測粗利率: 原価データ未接続のため算出不能';
  return `全社予測粗利率 ${marginRatePercent}%`;
}
