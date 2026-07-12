// 日本時間（Asia/Tokyo, UTC+9）で日付境界を扱うユーティリティ。
// 実行環境のタイムゾーンに依存しないよう、明示的に +9h オフセットで計算する（テスト決定性のため）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// UTCミリ秒 → JSTでの通算日インデックス
function jstDayIndex(ms: number): number {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS)
}

// JSTの「今日0:00」に相当するUTCミリ秒
export function startOfTodayJstMs(now: number = Date.now()): number {
  return jstDayIndex(now) * DAY_MS - JST_OFFSET_MS
}

// ISO文字列がJSTで「今日」か
export function isTodayJst(iso: string | null | undefined, now: number = Date.now()): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return jstDayIndex(t) === jstDayIndex(now)
}

// 期限文字列 → UTCミリ秒（"今日"/"本日" は今日、日付文字列はパース、不明はnull）
export function parseDeadlineMs(deadline: string | null | undefined, now: number = Date.now()): number | null {
  if (!deadline) return null
  if (deadline.includes('今日') || deadline.includes('本日')) return startOfTodayJstMs(now)
  const t = Date.parse(deadline)
  return Number.isNaN(t) ? null : t
}

// 期限がJSTで何日超過しているか。超過していない/期限なしは null。
export function overdueDaysJst(deadline: string | null | undefined, now: number = Date.now()): number | null {
  const t = parseDeadlineMs(deadline, now)
  if (t === null) return null
  const deadlineDay = jstDayIndex(t)
  const todayDay = jstDayIndex(now)
  if (deadlineDay >= todayDay) return null // 今日または未来は超過ではない
  return todayDay - deadlineDay
}

// 表示用: JSTの時刻 HH:MM
export function formatJstTime(iso: string | null | undefined): string {
  if (!iso) return '終日'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '終日'
  const d = new Date(t + JST_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
