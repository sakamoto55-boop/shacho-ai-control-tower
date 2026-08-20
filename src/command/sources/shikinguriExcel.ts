/**
 * 資金繰表xlsx（★R8年度(3月～).xlsx）をExcelJSで読み、CashSnapshotへ変換する薄いアダプタ。
 * 列レイアウト（1始まり）: 3=収入日付 4=請求先 7=入金額 / 10=支出日付 11=支払先 12=支払金額 13=備考 / 14=金庫日付 / 18=running残高
 * 純粋ロジックは shikinguri.ts に置き、ここはExcelの読み取り（値/計算結果の取り出し・シート選択）に限定する。
 */
import ExcelJS from 'exceljs';
import {
  currentBalance,
  dailySeries,
  extractLoans,
  toNumber,
  type CashSnapshot,
  type LoanRow,
  type RawRow
} from './shikinguri.js';

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    return (v as { result: unknown }).result;
  }
  return v;
}
function cellDate(cell: ExcelJS.Cell): Date | null {
  const v = cellValue(cell);
  return v instanceof Date ? v : null;
}
function cellText(cell: ExcelJS.Cell): string {
  const v = cellValue(cell);
  return v == null ? '' : String(v).trim();
}

/** シート名 "R8.8-R8.9(R8.8月経費表)" → その月の期間（6日〜翌5日）。令和8年=2026。 */
export function periodFromSheetName(name: string): { start: Date; end: Date; month: string } | null {
  const m = /R(\d+)\.(\d+)月/.exec(name);
  if (!m) return null;
  const reiwa = Number(m[1]);
  const month = Number(m[2]);
  const year = 2018 + reiwa; // 令和1=2019 → 2018+reiwa
  const start = new Date(Date.UTC(year, month - 1, 6));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month % 12, 5));
  return { start, end, month: `R${reiwa}.${month}` };
}

function sheetToRows(ws: ExcelJS.Worksheet): RawRow[] {
  const rows: RawRow[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    rows.push({
      date: cellDate(row.getCell(3)) ?? cellDate(row.getCell(10)) ?? cellDate(row.getCell(14)),
      incomeParty: cellText(row.getCell(4)),
      incomeAmount: toNumber(cellValue(row.getCell(7))),
      payParty: cellText(row.getCell(11)),
      payAmount: toNumber(cellValue(row.getCell(12))),
      memo: cellText(row.getCell(13)) || cellText(row.getCell(9)),
      balance: toNumber(cellValue(row.getCell(18)))
    });
  }
  return rows;
}

export async function snapshotFromBuffer(buffer: ArrayBuffer | Buffer, asOfIso: string): Promise<CashSnapshot> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const asOf = new Date(asOfIso);

  // 月別タブ（ベース/テンプレは除外）＋期間を解決
  const monthSheets = wb.worksheets
    .map((ws) => ({ ws, period: periodFromSheetName(ws.name) }))
    .filter((x): x is { ws: ExcelJS.Worksheet; period: NonNullable<ReturnType<typeof periodFromSheetName>> } => x.period !== null);

  // 当月タブ = asOfが期間に入るタブ
  const current = monthSheets.find(({ period }) => asOf >= period.start && asOf <= period.end) ?? null;

  let cur: { balance: number; date: Date } | null = null;
  let series: CashSnapshot['series'] = [];
  if (current) {
    const rows = sheetToRows(current.ws);
    cur = currentBalance(rows, asOf, current.period);
    series = dailySeries(rows, current.period);
  }

  // 資金の谷（当月＋翌月タブの、期間内の最小残高）
  let trough: CashSnapshot['trough'] = null;
  const forwardSheets = monthSheets.filter(({ period }) => period.end >= asOf);
  for (const { ws, period } of forwardSheets) {
    let carried: Date | null = null;
    for (let r = 4; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const d = cellDate(row.getCell(3)) ?? cellDate(row.getCell(10)) ?? cellDate(row.getCell(14));
      if (d) carried = d;
      const b = toNumber(cellValue(row.getCell(18)));
      if (b == null || carried == null) continue;
      if (carried < period.start || carried > period.end) continue;
      if (!trough || b < trough.balance) trough = { balance: b, date: carried.toISOString().slice(0, 10) };
    }
  }

  // 人別立替（全月タブ横断）
  const loans: LoanRow[] = [];
  for (const { ws, period } of monthSheets) {
    loans.push(...extractLoans(sheetToRows(ws), period.month));
  }
  const loanTotal = loans.reduce((s, l) => s + l.amount, 0);

  return {
    asOf: asOfIso,
    currentBalance: cur ? cur.balance : null,
    balanceDate: cur ? cur.date.toISOString().slice(0, 10) : null,
    series,
    trough,
    loans,
    loanTotal
  };
}
