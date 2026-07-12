import { describe, it, expect } from 'vitest'
import { isTodayJst, overdueDaysJst, startOfTodayJstMs, parseDeadlineMs } from './dateUtil'

// 固定の基準時刻（JST 2026-07-12 09:00 = UTC 2026-07-12 00:00）
const NOW = Date.parse('2026-07-12T00:00:00Z')

describe('dateUtil（Asia/Tokyo 日付境界）', () => {
  it('JSTの今日を正しく判定する', () => {
    // JST 2026-07-12 の範囲: UTC 07-11 15:00 〜 07-12 15:00
    expect(isTodayJst('2026-07-12T05:00:00Z', NOW)).toBe(true) // JST 14:00 今日
    expect(isTodayJst('2026-07-11T16:00:00Z', NOW)).toBe(true) // JST 07-12 01:00 今日
    expect(isTodayJst('2026-07-11T14:00:00Z', NOW)).toBe(false) // JST 07-11 23:00 昨日
    expect(isTodayJst('2026-07-12T15:30:00Z', NOW)).toBe(false) // JST 07-13 00:30 明日
  })

  it('日付境界: JST 00:00 直前/直後で当日がずれない', () => {
    const midnightJstUtc = startOfTodayJstMs(NOW) // JST 07-12 00:00 のUTC
    expect(isTodayJst(new Date(midnightJstUtc).toISOString(), NOW)).toBe(true)
    expect(isTodayJst(new Date(midnightJstUtc - 1).toISOString(), NOW)).toBe(false)
  })

  it('overdueDaysJst: 過去は超過日数、今日/未来/期限なしは null', () => {
    expect(overdueDaysJst('2026-07-10', NOW)).toBe(2) // 2日超過
    expect(overdueDaysJst('2026-07-11', NOW)).toBe(1)
    expect(overdueDaysJst('2026-07-12', NOW)).toBe(null) // 今日は超過でない
    expect(overdueDaysJst('2026-07-20', NOW)).toBe(null) // 未来
    expect(overdueDaysJst(null, NOW)).toBe(null) // 期限なし
    expect(overdueDaysJst('本日中', NOW)).toBe(null) // 今日扱い
  })

  it('parseDeadlineMs: 不正な文字列は null', () => {
    expect(parseDeadlineMs('あとで', NOW)).toBe(null)
    expect(parseDeadlineMs('', NOW)).toBe(null)
  })
})
