/**
 * 日付・時刻ユーティリティ。
 * システム標準TimezoneはAsia/Tokyo（UTC+9）。内部保持はISO(UTC)のまま、
 * 「今日」「当月」「締め」の判定は必ずJSTで行い、UTCとの変換をここに集約する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO日時(UTC)をJSTの 'YYYY-MM-DD' に変換する */
export function jstDate(iso: string): string {
  return new Date(Date.parse(iso) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO日時(UTC)をJSTの 'YYYY-MM' に変換する */
export function jstMonth(iso: string): string {
  return jstDate(iso).slice(0, 7);
}

/** JST日付文字列に日数を加算する */
export function addDaysJst(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 2つのJST日付の差（日数） */
export function diffDays(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000);
}

/** JST基準の曜日（0=日曜） */
export function jstDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

export type HolidayAdjustment = 'none' | 'previous_business_day' | 'next_business_day';

/**
 * 支払日の休日調整。土日＋指定祝日リストを非営業日として前倒し/後ろ倒しする。
 * 日本の祝日カレンダーはPhase Bで実データ（Google Calendar等）から供給する。
 */
export function adjustForHoliday(
  dateStr: string,
  adjustment: HolidayAdjustment,
  holidays: string[] = []
): string {
  if (adjustment === 'none') return dateStr;
  const isBusinessDay = (d: string) => {
    const dow = jstDayOfWeek(d);
    return dow !== 0 && dow !== 6 && !holidays.includes(d);
  };
  let result = dateStr;
  let guard = 0;
  while (!isBusinessDay(result) && guard < 14) {
    result = addDaysJst(result, adjustment === 'previous_business_day' ? -1 : 1);
    guard += 1;
  }
  return result;
}
