export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** YYYY-MM-DD を日数分ずらす。タイムゾーンの影響を受けないようUTCで計算する。 */
export function shiftIso(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** dateIso から target までの日数。過去なら正の数。 */
export function daysBetween(dateIso: string, target: string): number {
  const toUtc = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(target) - toUtc(dateIso)) / 86_400_000);
}

export function withinRange(dateIso: string, range?: { from?: string; to?: string }): boolean {
  if (!range) return true;
  const date = dateIso.slice(0, 10);
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** 入力された日付表現をYYYY-MM-DDへ。CLIで「今日」「明日」「3日後」を書けるようにする。 */
export function parseDateInput(input: string, now = new Date()): string | null {
  const value = input.trim();
  if (value === '' ) return null;
  if (value === '今日' || value === 'today') return todayIso(now);
  if (value === '明日' || value === 'tomorrow') return shiftIso(todayIso(now), 1);
  if (value === '昨日' || value === 'yesterday') return shiftIso(todayIso(now), -1);

  const afterDays = value.match(/^(\d{1,3})日後$/);
  if (afterDays) return shiftIso(todayIso(now), Number(afterDays[1]));

  const monthDay = value.match(/^(\d{1,2})[/月-](\d{1,2})日?$/);
  if (monthDay) {
    const month = monthDay[1].padStart(2, '0');
    const day = monthDay[2].padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}
