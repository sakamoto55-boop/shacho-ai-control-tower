/** 円を「12.3万円」の形にする。一人事業の数字は万円単位のほうが直感的に読める。 */
export function formatYen(yen: number): string {
  if (yen === 0) return '0円';
  const man = yen / 10_000;
  if (Math.abs(man) >= 10) return `${Math.round(man).toLocaleString('ja-JP')}万円`;
  return `${Math.round(man * 10) / 10}万円`;
}

/** 時給の表示。円単位のほうが判断しやすいのでこちらは円のまま。 */
export function formatHourly(yen: number | null): string {
  if (yen === null) return '算出不可（時間の記録なし）';
  return `${Math.round(yen).toLocaleString('ja-JP')}円/時`;
}

export function formatHours(hours: number): string {
  return `${Math.round(hours * 10) / 10}時間`;
}

/** 「30万」「300000」「12.5万円」を円に直す。CLI入力用。 */
export function parseYen(input: string): number | null {
  const value = input.trim().replace(/[,，\s円]/g, '');
  const man = value.match(/^(\d+(?:\.\d+)?)万$/);
  if (man) return Math.round(Number(man[1]) * 10_000);
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value));
  return null;
}
