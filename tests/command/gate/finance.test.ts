import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../../src/command/data/seed.js';
import {
  computeCashForecast,
  diffCashForecast,
  horizonBalance
} from '../../../src/command/engines/cashForecast.js';
import { buildAlerts } from '../../../src/command/engines/alerts.js';
import type { CashPlanEntry } from '../../../src/command/domain/types.js';

const ASOF = '2026-08-08T00:00:00.000Z'; // JST 2026-08-08(土) 09:00

describe('Gate: 資金繰りエンジン監査', () => {
  it('同一planIdの二重計上を排除する', () => {
    const dataset = buildSeedDataset(ASOF);
    const original = dataset.cashPlans.find((p) => p.planId === 'cp-out-sal')!;
    dataset.cashPlans.push({ ...original });
    const result = computeCashForecast(dataset, 'lcc');
    expect(result.duplicatesRemoved).toHaveLength(1);
    // 給与450万円が二重に引かれていないこと
    expect(horizonBalance(result, 30)).toBe(12_400_000);
  });

  it('planIdが違っても同一内容（法人・方向・金額・日付・ラベル）は二重計上しない', () => {
    const dataset = buildSeedDataset(ASOF);
    const original = dataset.cashPlans.find((p) => p.planId === 'cp-out-sal')!;
    dataset.cashPlans.push({ ...original, planId: 'cp-out-sal-dup' });
    const result = computeCashForecast(dataset, 'lcc');
    expect(result.duplicatesRemoved).toHaveLength(1);
    expect(horizonBalance(result, 30)).toBe(12_400_000);
  });

  it('銀行残高データがない場合、残高0ではなくbalanceKnown=falseを返し、アラートで明示する', () => {
    const dataset = buildSeedDataset(ASOF);
    dataset.cashAccounts = [];
    const result = computeCashForecast(dataset, 'lcc');
    expect(result.balanceKnown).toBe(false);
    expect(result.freshnessStatus).toBe('UNKNOWN');
    const alerts = buildAlerts(dataset, 'lcc');
    const cashAlert = alerts.find((a) => a.kind === 'cash_low')!;
    expect(cashAlert.detail).toContain('「問題なし」と判断できません');
  });

  it('残高がマイナスになる場合はCRITICALアラート', () => {
    const dataset = buildSeedDataset(ASOF);
    const extra: CashPlanEntry = {
      planId: 'cp-out-big',
      companyId: 'lcc',
      direction: 'out',
      category: 'one_time',
      amount: 30_000_000,
      date: '2026-08-20',
      status: 'CONFIRMED',
      label: '大型支払'
    };
    dataset.cashPlans.push(extra);
    const alerts = buildAlerts(dataset, 'lcc');
    const cashAlert = alerts.find((a) => a.kind === 'cash_low')!;
    expect(cashAlert.severity).toBe('CRITICAL');
  });

  it('休日支払の調整: 土曜予定の支払を前営業日（金曜）へ移せる', () => {
    const dataset = buildSeedDataset(ASOF);
    // 2026-08-15は土曜。土曜支払を1件だけにして検証する
    dataset.cashPlans = [
      {
        planId: 'cp-sat',
        companyId: 'lcc',
        direction: 'out',
        category: 'subcontract',
        amount: 1_000_000,
        date: '2026-08-15',
        status: 'CONFIRMED',
        label: '土曜予定の支払'
      }
    ];
    const none = computeCashForecast(dataset, 'lcc');
    expect(none.entries[0].date).toBe('2026-08-15');
    const adjusted = computeCashForecast(dataset, 'lcc', [], {
      holidayAdjustment: 'previous_business_day'
    });
    expect(adjusted.entries[0].date).toBe('2026-08-14'); // 金曜
    const next = computeCashForecast(dataset, 'lcc', [], {
      holidayAdjustment: 'next_business_day'
    });
    expect(next.entries[0].date).toBe('2026-08-17'); // 月曜
  });

  it('シナリオはbaseを破壊しない（rollback可能・純関数）', () => {
    const dataset = buildSeedDataset(ASOF);
    const base1 = computeCashForecast(dataset, 'lcc');
    const scenario = computeCashForecast(dataset, 'lcc', [
      { kind: 'delay_entry', planId: 'cp-in-d', days: 15 },
      { kind: 'add_payment', amount: 5_000_000, date: '2026-08-25', label: '車両' }
    ]);
    const base2 = computeCashForecast(dataset, 'lcc');
    expect(base2.minBalance).toEqual(base1.minBalance);
    expect(horizonBalance(base2, 30)).toBe(horizonBalance(base1, 30));
    expect(scenario.minBalance.balance).toBeLessThan(base1.minBalance.balance);
  });

  it('シナリオ差分（前後比較）を返す', () => {
    const dataset = buildSeedDataset(ASOF);
    const base = computeCashForecast(dataset, 'lcc');
    const scenario = computeCashForecast(dataset, 'lcc', [
      { kind: 'delay_entry', planId: 'cp-in-d', days: 15 }
    ]);
    const diff = diffCashForecast(base, scenario);
    const day30 = diff.horizonDiffs.find((h) => h.daysAhead === 30)!;
    expect(day30.diff).toBe(-10_000_000);
    const day90 = diff.horizonDiffs.find((h) => h.daysAhead === 90)!;
    expect(day90.diff).toBe(0);
  });

  it('日次残高推移（90日分）と最低残高の日付を保持する', () => {
    const dataset = buildSeedDataset(ASOF);
    const result = computeCashForecast(dataset, 'lcc');
    expect(result.dailyBalances).toHaveLength(90);
    expect(result.minBalance.balance).toBe(8_125_000);
    expect(result.minBalance.date).toBe(
      result.dailyBalances.find((d) => d.balance === 8_125_000)?.date
    );
  });

  it('CONFIRMED/EXPECTED/ESTIMATEDを区別し、確定のみ残高を別に持つ', () => {
    const dataset = buildSeedDataset(ASOF);
    const scenario = computeCashForecast(dataset, 'lcc', [
      { kind: 'add_receipt', amount: 9_999_999, date: '2026-08-20', label: '推計入金' }
    ]);
    const added = scenario.entries.find((e) => e.label.includes('推計入金'))!;
    expect(added.status).toBe('ESTIMATED');
    const day30 = scenario.dailyBalances.filter((d) => d.date <= '2026-09-07').at(-1)!;
    // 推計入金はconfirmedOnlyBalanceへ入らない
    expect(day30.balance - day30.confirmedOnlyBalance).toBeGreaterThanOrEqual(9_999_999);
  });

  it('JST月次締め: UTC月末夜（JST翌月）は翌月として扱う', async () => {
    const { computeSalesSummary } = await import('../../../src/command/engines/sales.js');
    const beforeMidnight = buildSeedDataset('2026-08-31T10:00:00.000Z'); // JST 8/31 19:00
    expect(computeSalesSummary(beforeMidnight, 'lcc').month).toBe('2026-08');
    const afterMidnight = buildSeedDataset('2026-08-31T20:00:00.000Z'); // JST 9/1 05:00
    const sales = computeSalesSummary(afterMidnight, 'lcc');
    expect(sales.month).toBe('2026-09');
    // 8月完工分は9月の確定売上に混ざらない（月跨ぎ）
    expect(sales.confirmedSales).toBe(0);
  });
});
