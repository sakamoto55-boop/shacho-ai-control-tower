import { describe, expect, it } from 'vitest';
import { daysBetween, parseDateInput, shiftIso } from '../../src/utils/date.js';
import { formatYen, parseYen } from '../../src/utils/money.js';

const NOW = new Date('2026-08-19T09:00:00.000Z');

describe('日付', () => {
  it('日数をずらす', () => {
    expect(shiftIso('2026-08-19', 3)).toBe('2026-08-22');
    expect(shiftIso('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('日数の差を出す', () => {
    expect(daysBetween('2026-08-15', '2026-08-19')).toBe(4);
    expect(daysBetween('2026-08-19', '2026-08-19')).toBe(0);
  });

  it('人が書く日付表現を読む', () => {
    expect(parseDateInput('今日', NOW)).toBe('2026-08-19');
    expect(parseDateInput('明日', NOW)).toBe('2026-08-20');
    expect(parseDateInput('3日後', NOW)).toBe('2026-08-22');
    expect(parseDateInput('8-25', NOW)).toBe('2026-08-25');
    expect(parseDateInput('9月3日', NOW)).toBe('2026-09-03');
    expect(parseDateInput('2026-12-31', NOW)).toBe('2026-12-31');
    expect(parseDateInput('よくわからない', NOW)).toBeNull();
  });
});

describe('金額', () => {
  it('万円表記を円に直す', () => {
    expect(parseYen('30万')).toBe(300_000);
    expect(parseYen('12.5万')).toBe(125_000);
    expect(parseYen('300000')).toBe(300_000);
    expect(parseYen('1,500,000円')).toBe(1_500_000);
    expect(parseYen('たくさん')).toBeNull();
  });

  it('読みやすい万円表記にする', () => {
    expect(formatYen(1_500_000)).toBe('150万円');
    expect(formatYen(50_000)).toBe('5万円');
    expect(formatYen(0)).toBe('0円');
  });
});
