/**
 * 資金繰り予測エンジン（最優先機能）。
 *
 * AIに計算させない。決定論的に
 *   現在現預金 ＋ 入金予定 － 支払予定 ＝ 将来残高
 * を日次で積み上げ、7/30/60/90日の予測とシナリオ分析を行う。
 * 確定（confirmed）と予測（forecast）は区別して保持する。
 */
import type {
  CashForecastResult,
  CashPlanEntry,
  CashScenarioAdjustment,
  CompanyScope,
  Evidence
} from '../domain/types.js';
import { CASH_PLAN_CATEGORY_LABELS } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { shiftDate } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';

export const FORECAST_HORIZONS = [7, 30, 60, 90] as const;

function applyAdjustments(
  entries: CashPlanEntry[],
  adjustments: CashScenarioAdjustment[]
): CashPlanEntry[] {
  let result = entries.map((entry) => ({ ...entry }));
  for (const adj of adjustments) {
    if (adj.kind === 'delay_entry') {
      result = result.map((entry) =>
        entry.planId === adj.planId
          ? { ...entry, date: shiftDate(`${entry.date}T00:00:00.000Z`, adj.days) }
          : entry
      );
    } else if (adj.kind === 'remove_entry') {
      result = result.filter((entry) => entry.planId !== adj.planId);
    } else if (adj.kind === 'add_payment') {
      result.push({
        planId: `scenario-out-${result.length}`,
        companyId: 'scenario',
        direction: 'out',
        category: 'other',
        amount: adj.amount,
        date: adj.date,
        certainty: 'forecast',
        label: `【シナリオ】${adj.label}`
      });
    } else {
      result.push({
        planId: `scenario-in-${result.length}`,
        companyId: 'scenario',
        direction: 'in',
        category: 'receipt',
        amount: adj.amount,
        date: adj.date,
        certainty: 'forecast',
        label: `【シナリオ】${adj.label}`
      });
    }
  }
  return result;
}

export function computeCashForecast(
  dataset: CommandDataset,
  scope: CompanyScope,
  adjustments: CashScenarioAdjustment[] = []
): CashForecastResult {
  const scoped = filterDatasetByScope(dataset, scope);
  const asOfDate = dataset.asOf.slice(0, 10);
  const horizonEnd = shiftDate(dataset.asOf, 90);

  const currentBalance = scoped.cashAccounts.reduce((sum, account) => sum + account.balance, 0);
  const entries = applyAdjustments(scoped.cashPlans, adjustments)
    .filter((entry) => entry.date > asOfDate && entry.date <= horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 日次残高: プラン発生日ごとに積み上げ、ホライズン日を含む全変化点を記録する
  const points: CashForecastResult['points'] = [];
  let balance = currentBalance;
  let confirmedOnlyBalance = currentBalance;
  let minBalance = { date: asOfDate, balance: currentBalance };

  const horizonDates = FORECAST_HORIZONS.map((days) => shiftDate(dataset.asOf, days));
  const changeDates = [...new Set([...entries.map((entry) => entry.date), ...horizonDates])].sort();

  for (const date of changeDates) {
    for (const entry of entries.filter((item) => item.date === date)) {
      const signed = entry.direction === 'in' ? entry.amount : -entry.amount;
      balance += signed;
      if (entry.certainty === 'confirmed') confirmedOnlyBalance += signed;
    }
    const daysAhead = Math.round((Date.parse(date) - Date.parse(asOfDate)) / 86_400_000);
    points.push({ date, daysAhead, balance, confirmedOnlyBalance });
    if (balance < minBalance.balance) minBalance = { date, balance };
  }

  const accountEvidence: Evidence[] = scoped.cashAccounts.map((account) => ({
    label: `${account.bankName} 残高`,
    value: `${account.balance.toLocaleString()}円`,
    refId: account.accountId,
    source: account.freshness.source,
    asOf: account.freshness.lastUpdatedAt
  }));
  const planEvidence: Evidence[] = entries.map((entry) => ({
    label: `${entry.direction === 'in' ? '入金' : '支払'}予定（${CASH_PLAN_CATEGORY_LABELS[entry.category]}・${
      entry.certainty === 'confirmed' ? '確定' : '予測'
    }）${entry.label}`,
    value: `${entry.date} ${entry.amount.toLocaleString()}円`,
    refId: entry.planId,
    source: '資金繰り予定表',
    asOf: dataset.asOf
  }));

  const oldestAccount = scoped.cashAccounts.reduce(
    (oldest, account) =>
      account.freshness.lastUpdatedAt < oldest.lastUpdatedAt ? account.freshness : oldest,
    scoped.cashAccounts[0]?.freshness ?? {
      lastUpdatedAt: dataset.asOf,
      source: 'データなし',
      stale: true
    }
  );

  return {
    scope,
    asOf: dataset.asOf,
    currentBalance,
    points,
    minBalance,
    entries,
    freshness: oldestAccount,
    evidence: [...accountEvidence, ...planEvidence]
  };
}

/** ホライズン日（7/30/60/90日後）の残高を取り出す */
export function horizonBalance(result: CashForecastResult, daysAhead: number): number {
  const targetDate = shiftDate(result.asOf, daysAhead);
  let balance = result.currentBalance;
  for (const point of result.points) {
    if (point.date <= targetDate) balance = point.balance;
  }
  return balance;
}
