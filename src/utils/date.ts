export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysIsoDate(days: number, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return todayIsoDate(date);
}

/** YYYY-MM-DD を日数分ずらす。タイムゾーンの影響を受けないようUTCで計算する。 */
export function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.slice(0, 10).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** YYYY-MM-DD の曜日（0=日曜）。UTC基準で判定する。 */
export function dayOfWeekIso(dateIso: string): number {
  const [year, month, day] = dateIso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isSameDate(isoOrDateText: string | null, target = todayIsoDate()): boolean {
  if (!isoOrDateText) return false;
  return isoOrDateText.slice(0, 10) === target;
}

export function isBeforeDate(isoOrDateText: string | null, target = todayIsoDate()): boolean {
  if (!isoOrDateText) return false;
  return isoOrDateText.slice(0, 10) < target;
}

export function parseJapaneseDueDate(text: string, now = new Date()): { dueDate: string | null; dueDateText: string } {
  const normalized = text.replace(/\s+/g, '');

  if (/今日中|本日中|今日/.test(normalized)) {
    return { dueDate: todayIsoDate(now), dueDateText: '今日中' };
  }

  if (/明日|翌日/.test(normalized)) {
    return { dueDate: addDaysIsoDate(1, now), dueDateText: '明日' };
  }

  if (/今週中|週内/.test(normalized)) {
    return { dueDate: null, dueDateText: '今週中' };
  }

  const jpDate = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  if (jpDate) {
    const year = now.getFullYear();
    const month = jpDate[1].padStart(2, '0');
    const day = jpDate[2].padStart(2, '0');
    return { dueDate: `${year}-${month}-${day}`, dueDateText: jpDate[0] };
  }

  const isoDate = normalized.match(/20\d{2}-\d{2}-\d{2}/);
  if (isoDate) {
    return { dueDate: isoDate[0], dueDateText: isoDate[0] };
  }

  return { dueDate: null, dueDateText: '期限未記載' };
}
