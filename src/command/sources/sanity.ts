/**
 * サニティチェック（Phase B1 §4）。
 *
 * ソース側の件数（正本の監査ログ等で確認した実件数）とCanonical取込後の件数を照合し、
 * 大きな乖離がある間は実データを会話へ提示しない（NOT READY）。
 * 「部分的に取れたデータを全量として提示する」事故を防ぐための決定論ゲート。
 */

export interface SanityExpectation {
  /** 照合対象名（例: customers / projects） */
  name: string;
  /** ソース側で確認した件数（正本の監査ログ・シート実測） */
  expected: number;
  /** Canonical取込後の件数 */
  actual: number;
}

export interface SanityResult {
  ready: boolean;
  lines: string[];
  /** 乖離が許容率を超えた項目 */
  failures: SanityExpectation[];
}

/**
 * 期待件数との乖離を判定する。tolerance は許容乖離率（既定5%）。
 * expected が 0 の項目は「ソース側も空」を意味し、actual も 0 のときのみ合格。
 */
export function evaluateSanity(items: SanityExpectation[], tolerance = 0.05): SanityResult {
  const failures: SanityExpectation[] = [];
  const lines: string[] = [];
  for (const item of items) {
    const diff = Math.abs(item.actual - item.expected);
    const ratio = item.expected === 0 ? (item.actual === 0 ? 0 : 1) : diff / item.expected;
    const ok = ratio <= tolerance;
    if (!ok) failures.push(item);
    lines.push(
      `${ok ? 'OK ' : 'NG '} ${item.name}: ソース${item.expected}件 / Canonical${item.actual}件（乖離${Math.round(ratio * 1000) / 10}%）`
    );
  }
  const ready = failures.length === 0 && items.length > 0;
  lines.push(
    ready
      ? '判定: READY — 件数照合に合格。実データを会話へ提示できます。'
      : '判定: NOT READY — 乖離が大きいため、実データを会話へ提示しません（DATA_UNAVAILABLE維持）。'
  );
  return { ready, lines, failures };
}
