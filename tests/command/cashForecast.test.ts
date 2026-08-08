import { describe, expect, it } from 'vitest';
import { buildSeedDataset } from '../../src/command/data/seed.js';
import { computeCashForecast, horizonBalance } from '../../src/command/engines/cashForecast.js';

const ASOF = '2026-08-08T00:00:00.000Z';

describe('資金繰り予測エンジン', () => {
  it('現在現預金＋入金予定－支払予定を決定論的に積み上げる', () => {
    const dataset = buildSeedDataset(ASOF);
    const result = computeCashForecast(dataset, 'lcc');

    expect(result.currentBalance).toBe(15_500_000);
    // 7日以内は入出金なし
    expect(horizonBalance(result, 7)).toBe(15_500_000);
    // 30日圏: +3.3M(10日) -4.5M(17日) +10M(20日) -11.9M(23日) = 12.4M
    expect(horizonBalance(result, 30)).toBe(12_400_000);
    // 90日圏の最低残高: 45日目+5.225M、47日目-4.5M（翌月給与）、53日目-5M（翌月外注）= 8.125M
    expect(result.minBalance.balance).toBe(8_125_000);
  });

  it('確定のみの残高（confirmedOnlyBalance）は予測入金を含まない', () => {
    const dataset = buildSeedDataset(ASOF);
    const result = computeCashForecast(dataset, 'lcc');
    const day30 = result.points.filter((point) => point.daysAhead <= 30).at(-1);
    // 予測扱いの入金3.3Mを除くと 15.5 - 4.5 + 10 - 11.9 = 9.1M
    expect(day30?.confirmedOnlyBalance).toBe(9_100_000);
  });

  it('シナリオ: 入金遅延で30日後残高が悪化する', () => {
    const dataset = buildSeedDataset(ASOF);
    const base = computeCashForecast(dataset, 'lcc');
    const scenario = computeCashForecast(dataset, 'lcc', [
      { kind: 'delay_entry', planId: 'cp-in-d', days: 15 }
    ]);
    expect(horizonBalance(scenario, 30)).toBe(horizonBalance(base, 30) - 10_000_000);
    // 90日圏では入金が戻るため一致する
    expect(horizonBalance(scenario, 90)).toBe(horizonBalance(base, 90));
  });

  it('シナリオ: 支出追加で最低残高が下がる', () => {
    const dataset = buildSeedDataset(ASOF);
    const base = computeCashForecast(dataset, 'lcc');
    const scenario = computeCashForecast(dataset, 'lcc', [
      { kind: 'add_payment', amount: 5_000_000, date: '2026-08-30', label: '車両購入' }
    ]);
    expect(scenario.minBalance.balance).toBe(base.minBalance.balance - 5_000_000);
  });

  it('法人スコープを混在させない', () => {
    const dataset = buildSeedDataset(ASOF);
    const wel = computeCashForecast(dataset, 'wel');
    expect(wel.currentBalance).toBe(2_000_000);
    expect(wel.entries.every((entry) => entry.companyId === 'wel')).toBe(true);

    const group = computeCashForecast(dataset, 'group');
    expect(group.currentBalance).toBe(17_500_000);
  });

  it('根拠と鮮度を保持する', () => {
    const dataset = buildSeedDataset(ASOF);
    const result = computeCashForecast(dataset, 'lcc');
    expect(result.freshness.stale).toBe(true); // 銀行残高は前営業日
    expect(result.evidence.some((evidence) => evidence.label.includes('山陰合同銀行'))).toBe(true);
  });
});
