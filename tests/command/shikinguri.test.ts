import { describe, expect, it } from 'vitest';
import { toNumber, currentBalance, dailySeries, extractLoans, extractUpcoming, monthTotals, type RawRow } from '../../src/command/sources/shikinguri.js';

const d = (s: string) => new Date(s + 'T00:00:00Z');

describe('資金繰表の解析（決定論・シート記載値のみ）', () => {
  it('toNumber: カンマ・円・▲・空白・括弧を処理する', () => {
    expect(toNumber('3,562,522 ')).toBe(3562522);
    expect(toNumber('▲ 6,144,948')).toBe(-6144948);
    expect(toNumber('△1,000')).toBe(-1000);
    expect(toNumber('(500)')).toBe(-500);
    expect(toNumber('12000円')).toBe(12000);
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(8289832)).toBe(8289832);
  });

  it('currentBalance: 日付を繰り越し、asOf以下で最大日付の残高を取る（末尾の外れ値行を拾わない）', () => {
    const period = { start: d('2026-08-06'), end: d('2026-09-06') };
    const rows: RawRow[] = [
      { date: d('2026-08-16'), payParty: '電気代', payAmount: 15000, balance: 4138962 },
      { date: null, balance: 4138962 }, // 日付なし＝繰り越し
      { date: d('2026-08-20'), incomeParty: 'フクダ', incomeAmount: 924000, balance: 5062962 },
      { date: null, incomeParty: '和泉武雄さま', incomeAmount: 38500, balance: 8289832 },
      // 末尾の外れ値行（期間外の日付）＝拾ってはいけない
      { date: d('2026-04-30'), balance: 14428361 },
      { date: d('2025-01-05'), balance: 14411861 }
    ];
    const r = currentBalance(rows, d('2026-08-20'), period);
    expect(r?.balance).toBe(8289832);
    expect(r?.date.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('currentBalance: asOfより未来の残高は使わない', () => {
    const rows: RawRow[] = [
      { date: d('2026-08-20'), balance: 8289832 },
      { date: d('2026-09-04'), balance: 10054943 } // 未来（計画）
    ];
    expect(currentBalance(rows, d('2026-08-20'))?.balance).toBe(8289832);
  });

  it('dailySeries: 同日は最終値・date昇順', () => {
    const rows: RawRow[] = [
      { date: d('2026-08-20'), balance: 5062962 },
      { date: null, balance: 8289832 }, // 同日の最終残高
      { date: d('2026-08-16'), balance: 4138962 }
    ];
    const s = dailySeries(rows);
    expect(s).toEqual([
      { date: '2026-08-16', balance: 4138962 },
      { date: '2026-08-20', balance: 8289832 }
    ]);
  });

  it('extractLoans: 立替・貸付の支出行のみ抽出する', () => {
    const rows: RawRow[] = [
      { date: d('2026-08-16'), payParty: '電気代', memo: 'コーポ坂本（小田/立替）', payAmount: 15000 },
      { date: d('2026-08-16'), payParty: '電気代', memo: 'みらい立替', payAmount: 13000 },
      { date: d('2026-08-16'), payParty: '給料', memo: '', payAmount: 7000000 }, // 立替でない→除外
      { date: d('2026-08-16'), payParty: '青木水道', memo: '立替(鳥越様へ請求)/浜町解体', payAmount: 33000 }
    ];
    const loans = extractLoans(rows, 'R8.8');
    expect(loans).toHaveLength(3);
    expect(loans.reduce((s, l) => s + l.amount, 0)).toBe(61000);
    expect(loans.some((l) => l.memo.includes('鳥越'))).toBe(true);
  });

  it('extractUpcoming: asOf以降の支出行を近い順に返す（過去・入金・期間外は除外）', () => {
    const period = { start: d('2026-08-06'), end: d('2026-09-06') };
    const asOf = d('2026-08-20');
    const rows: RawRow[] = [
      { date: d('2026-08-10'), payParty: '過去支払', payAmount: 100 }, // asOf以前→除外
      { date: d('2026-08-25'), payParty: '鳥銀', payAmount: 350000, memo: '返済' },
      { date: d('2026-09-05'), payParty: '給料', payAmount: 7000000 }, // 期間内（8/6-9/6）
      { date: d('2026-08-22'), incomeAmount: 500000, payParty: '', payAmount: null }, // 入金・支払先なし→除外
      { date: d('2026-09-20'), payParty: '期間外', payAmount: 999 } // 期間外→除外
    ];
    const up = extractUpcoming(rows, asOf, period);
    expect(up.map((u) => u.payParty)).toEqual(['鳥銀', '給料']);
    expect(up[0].date).toBe('2026-08-25');
  });

  it('monthTotals: 期間内の入金計・支出計を合計する（期間外・0/負は除外）', () => {
    const period = { start: d('2026-08-06'), end: d('2026-09-06') };
    const rows: RawRow[] = [
      { date: d('2026-08-10'), incomeAmount: 500000, payAmount: null },
      { date: d('2026-08-12'), incomeAmount: null, payAmount: 300000 },
      { date: d('2026-08-15'), incomeAmount: 200000, payAmount: 100000 },
      { date: d('2026-09-20'), incomeAmount: 999, payAmount: 999 } // 期間外→除外
    ];
    const t = monthTotals(rows, period);
    expect(t.income).toBe(700000);
    expect(t.expense).toBe(400000);
  });
});
