import { describe, expect, it } from 'vitest';
import {
  checkStall,
  grossProfitYen,
  isActionDueToday,
  isActionOverdue,
  isOpenDeal,
  receivedYen,
  unpaidYen
} from '../../src/domain/dealRules.js';
import { makeDeal, makeMoney } from '../fixtures.js';

describe('checkStall', () => {
  it('段階ごとの目安日数を超えたら放置と判定する', () => {
    // 引き合いの目安は2日
    const deal = makeDeal({ stage: 'inquiry', lastTouchedOn: '2026-08-15' });
    expect(checkStall(deal, '2026-08-19').stalled).toBe(true);
    expect(checkStall(deal, '2026-08-16').stalled).toBe(false);
  });

  it('請求済みは目安が長い（すぐ催促しない）', () => {
    const deal = makeDeal({ stage: 'invoiced', lastTouchedOn: '2026-08-12' });
    expect(checkStall(deal, '2026-08-19').stalled).toBe(false);
  });

  it('終わった案件は放置と数えない', () => {
    const deal = makeDeal({ stage: 'lost', lastTouchedOn: '2026-01-01' });
    expect(checkStall(deal, '2026-08-19').stalled).toBe(false);
    expect(isOpenDeal(deal)).toBe(false);
  });
});

describe('次アクションの期限', () => {
  it('期限切れと当日を区別する', () => {
    const overdue = makeDeal({ nextActionOn: '2026-08-18' });
    const today = makeDeal({ nextActionOn: '2026-08-19' });

    expect(isActionOverdue(overdue, '2026-08-19')).toBe(true);
    expect(isActionDueToday(overdue, '2026-08-19')).toBe(false);
    expect(isActionDueToday(today, '2026-08-19')).toBe(true);
  });

  it('終わった案件の期限は無視する', () => {
    const deal = makeDeal({ stage: 'paid', nextActionOn: '2026-01-01' });
    expect(isActionOverdue(deal, '2026-08-19')).toBe(false);
  });
});

describe('金額', () => {
  it('粗利は金額から直接費を引く', () => {
    expect(grossProfitYen(makeDeal({ amountYen: 1_500_000, costYen: 600_000 }))).toBe(900_000);
    expect(grossProfitYen(makeDeal({ amountYen: null }))).toBeNull();
  });

  it('未入金は受け取った分を差し引いた残りにする', () => {
    const deal = makeDeal({ id: 'd1', stage: 'invoiced', amountYen: 500_000 });
    const partial = [makeMoney({ dealId: 'd1', amountYen: 200_000 })];

    expect(receivedYen(deal, partial)).toBe(200_000);
    expect(unpaidYen(deal, partial)).toBe(300_000);
    expect(unpaidYen(deal, [makeMoney({ dealId: 'd1', amountYen: 500_000 })])).toBe(0);
  });

  it('請求前の案件は未入金に数えない', () => {
    expect(unpaidYen(makeDeal({ stage: 'quoted', amountYen: 500_000 }), [])).toBe(0);
  });
});
