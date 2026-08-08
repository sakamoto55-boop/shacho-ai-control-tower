/**
 * 資金繰り予測エンジン(最優先機能)。
 *
 * AIに計算させない。決定論的に
 *   現在現預金 + 入金予定 - 支払予定 = 将来残高
 * を日次で積み上げ、7/30/60/90日の予測とシナリオ分析を行う。
 *
 * - 確定(CONFIRMED)・予定(EXPECTED)・推計(ESTIMATED)を混ぜずに保持する
 * - 同一planId・同一内容(法人/方向/金額/日付/ラベル)の二重計上を除外する
 * - 支払日の休日調整(前営業日/翌営業日)を設定できる
 * - 90日分の日次残高推移と最低残高(日付付き)を返す
 * - 口座データが1件もない場合は balanceKnown=false とし、残高0と混同しない
 */
import type {
  CashForecastDiff,
  CashForecastResult,
  CashPlanEntry,
  CashScenarioAdjustment,
  CompanyScope,
  Evidence,
  Freshness,
  FreshnessStatus
} from '../domain/types.js';
import { CASH_PLAN_CATEGORY_LABELS } from '../domain/types.js';
import type { CommandDataset } from '../data/seed.js';
import { shiftDate } from '../data/seed.js';
import { filterDatasetByScope } from '../domain/scope.js';
import { addDaysJst, adjustForHoliday, jstDate, type HolidayAdjustment } from '../utils/jst.js';

export const FORECAST_HORIZONS = [7, 30, 60, 90] as const;

export interface CashForecastOptions {
  /** 支払日(direction='out')の休日調整。既定は調整なし */
  holidayAdjustment?: HolidayAdjustment;
  /** 祝日リスト(YYYY-MM-DD)。Phase Bでカレンダーソースから供給する */
  holidays?: string[];
}

const STATUS_LABELS: Record<CashPlanEntry['status'], string> = {
  CONFIRMED: '確定',
  EXPECTED: '予定',
  ESTIMATED: '推計'
};

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
        category: 'one_time',
        amount: adj.amount,
        date: adj.date,
        status: 'ESTIMATED',
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
        status: 'ESTIMATED',
        label: `【シナリオ】${adj.label}`
      });
    }
  }
  return result;
}

/** 同一planId・同一内容の二重計上を除外する */
function dedupeEntries(entries: CashPlanEntry[]): {
  unique: CashPlanEntry[];
  duplicates: CashPlanEntry[];
} {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const unique: CashPlanEntry[] = [];
  const duplicates: CashPlanEntry[] = [];
  for (const entry of entries) {
    const contentKey = [
      entry.companyId,
      entry.direction,
      entry.amount,
      entry.date,
      entry.label
    ].join('|');
    if (seenIds.has(entry.planId) || seenContent.has(contentKey)) {
      duplicates.push(entry);
      continue;
    }
    seenIds.add(entry.planId);
    seenContent.add(contentKey);
    unique.push(entry);
  }
  return { unique, duplicates };
}

/** 銀行残高の鮮度ステータス。1日以内=FRESH / 3日以内=STALE / それ超=VERY_STALE */
export function cashFreshnessStatus(freshness: Freshness | null, asOf: string): FreshnessStatus {
  if (!freshness || !freshness.lastUpdatedAt) return 'UNKNOWN';
  const ageDays = (Date.parse(asOf) - Date.parse(freshness.lastUpdatedAt)) / 86_400_000;
  if (Number.isNaN(ageDays)) return 'UNKNOWN';
  if (ageDays <= 1.5) return 'FRESH';
  if (ageDays <= 3) return 'STALE';
  return 'VERY_STALE';
}

export function computeCashForecast(
  dataset: CommandDataset,
  scope: CompanyScope,
  adjustments: CashScenarioAdjustment[] = [],
  options: CashForecastOptions = {}
): CashForecastResult {
  const scoped = filterDatasetByScope(dataset, scope);
  const asOfDate = jstDate(dataset.asOf);
  const horizonEnd = addDaysJst(asOfDate, 90);
  const holidayAdjustment = options.holidayAdjustment ?? 'none';

  const balanceKnown = scoped.cashAccounts.length > 0;
  const currentBalance = scoped.cashAccounts.reduce((sum, account) => sum + account.balance, 0);

  const { unique, duplicates } = dedupeEntries(applyAdjustments(scoped.cashPlans, adjustments));
  const entries = unique
    .map((entry) =>
      entry.direction === 'out'
        ? { ...entry, date: adjustForHoliday(entry.date, holidayAdjustment, options.holidays) }
        : entry
    )
    .filter((entry) => entry.date > asOfDate && entry.date <= horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 日次残高: 90日分の全日付を保持する
  const dailyBalances: CashForecastResult['dailyBalances'] = [];
  const points: CashForecastResult['points'] = [];
  let balance = currentBalance;
  let confirmedOnlyBalance = currentBalance;
  let minBalance = { date: asOfDate, balance: currentBalance };
  const horizonSet = new Set(FORECAST_HORIZONS.map((days) => addDaysJst(asOfDate, days)));

  for (let day = 1; day <= 90; day += 1) {
    const date = addDaysJst(asOfDate, day);
    const dayEntries = entries.filter((item) => item.date === date);
    for (const entry of dayEntries) {
      const signed = entry.direction === 'in' ? entry.amount : -entry.amount;
      balance += signed;
      if (entry.status === 'CONFIRMED') confirmedOnlyBalance += signed;
    }
    dailyBalances.push({ date, balance, confirmedOnlyBalance });
    if (dayEntries.length > 0 || horizonSet.has(date)) {
      points.push({ date, daysAhead: day, balance, confirmedOnlyBalance });
    }
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
    label: `${entry.direction === 'in' ? '入金' : '支払'}予定(${CASH_PLAN_CATEGORY_LABELS[entry.category]}・${STATUS_LABELS[entry.status]})${entry.label}`,
    value: `${entry.date} ${entry.amount.toLocaleString()}円`,
    refId: entry.planId,
    source: '資金繰り予定表',
    asOf: dataset.asOf
  }));

  const oldestAccount = scoped.cashAccounts.reduce(
    (oldest, account) =>
      account.freshness.lastUpdatedAt < oldest.lastUpdatedAt ? account.freshness : oldest,
    scoped.cashAccounts[0]?.freshness ?? {
      lastUpdatedAt: '',
      source: 'データなし',
      stale: true
    }
  );

  return {
    scope,
    asOf: dataset.asOf,
    balanceKnown,
    currentBalance,
    points,
    dailyBalances,
    minBalance,
    entries,
    duplicatesRemoved: duplicates,
    freshness: oldestAccount,
    freshnessStatus: balanceKnown ? cashFreshnessStatus(oldestAccount, dataset.asOf) : 'UNKNOWN',
    evidence: [...accountEvidence, ...planEvidence]
  };
}

/** ホライズン日(7/30/60/90日後)の残高を取り出す */
export function horizonBalance(result: CashForecastResult, daysAhead: number): number {
  const targetDate = addDaysJst(jstDate(result.asOf), daysAhead);
  let balance = result.currentBalance;
  for (const point of result.dailyBalances) {
    if (point.date <= targetDate) balance = point.balance;
  }
  return balance;
}

/** シナリオ変更前後の差分。UI・回答で「何がどれだけ変わるか」を明示する */
export function diffCashForecast(
  base: CashForecastResult,
  scenario: CashForecastResult
): CashForecastDiff {
  return {
    horizonDiffs: FORECAST_HORIZONS.map((daysAhead) => {
      const baseBalance = horizonBalance(base, daysAhead);
      const scenarioBalance = horizonBalance(scenario, daysAhead);
      return {
        daysAhead,
        base: baseBalance,
        scenario: scenarioBalance,
        diff: scenarioBalance - baseBalance
      };
    }),
    minBalanceBase: base.minBalance,
    minBalanceScenario: scenario.minBalance
  };
}
