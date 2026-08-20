/**
 * 資金繰表（★R8年度(3月～).xlsx）の解析。
 * - 月別「経費表」タブ（収入／支出／running残高＝18列目）から、現預金・資金推移・人別立替を決定論的に抽出。
 * - 数値はシート記載値のみ（AIに暗算させない）。▲はマイナス。金額はカンマ・円を除去して数値化。
 * - 現預金は「当月タブの、asOf以下で最大日付」のrunning残高（行順ではなく日付順。末尾の外れ値行を拾わない）。
 * - 人別立替は備考／支払先に『立替』『貸付』を含む支出行を抽出（＝会社が誰かの分を立て替えた金額）。
 * 純粋関数（RawRow[]）としてテスト可能にし、ExcelJS読取は薄いアダプタに寄せる。
 */

export interface RawRow {
  /** 行内で確定した日付（income/expense/金庫のいずれかの日付列。無ければnull） */
  date: Date | null;
  incomeParty?: string;
  incomeAmount?: number | null;
  payParty?: string;
  payAmount?: number | null;
  memo?: string;
  /** running残高（18列目）。無ければnull */
  balance?: number | null;
}

export interface LoanRow {
  month: string;
  payParty: string;
  memo: string;
  amount: number;
}

export interface CashSnapshot {
  asOf: string;
  /** asOf時点の現預金（running残高）。取得不能ならnull */
  currentBalance: number | null;
  balanceDate: string | null;
  /** 当月タブの日次残高（date昇順・重複日は最終値） */
  series: Array<{ date: string; balance: number }>;
  /** 計画上の資金の谷（最小残高）とその日付。当月＋先月タブ横断 */
  trough: { balance: number; date: string | null } | null;
  loans: LoanRow[];
  loanTotal: number;
}

/** カンマ・円・空白・▲ を処理して数値化（▲/△/(...)/末尾-はマイナス） */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /[▲△-]/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[▲△(),\s円]/g, '').replace(/-/g, '');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

/** 日付を行に繰り越して、asOf以下で最大日付のrunning残高を返す（末尾の外れ値行を拾わない） */
export function currentBalance(
  rows: RawRow[],
  asOf: Date,
  period?: { start: Date; end: Date }
): { balance: number; date: Date } | null {
  let carried: Date | null = null;
  let best: { balance: number; date: Date } | null = null;
  for (const row of rows) {
    if (row.date) carried = row.date;
    if (row.balance == null || carried == null) continue;
    if (carried > asOf) continue;
    // 期間指定があれば期間外の日付（データ入力の外れ値）を除外
    if (period && (carried < period.start || carried > period.end)) continue;
    if (!best || carried >= best.date) best = { balance: row.balance, date: carried };
  }
  return best;
}

/** 当月タブの日次残高系列（date昇順・同日は最終値） */
export function dailySeries(rows: RawRow[], period?: { start: Date; end: Date }): Array<{ date: string; balance: number }> {
  let carried: Date | null = null;
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.date) carried = row.date;
    if (row.balance == null || carried == null) continue;
    if (period && (carried < period.start || carried > period.end)) continue;
    byDay.set(carried.toISOString().slice(0, 10), row.balance);
  }
  return [...byDay.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => a.date.localeCompare(b.date));
}

/** 立替・貸付の支出行を抽出（会社が誰かの分を立て替えた金額） */
export function extractLoans(rows: RawRow[], month: string): LoanRow[] {
  const out: LoanRow[] = [];
  for (const row of rows) {
    const payParty = (row.payParty ?? '').trim();
    const memo = (row.memo ?? '').trim();
    const amt = row.payAmount ?? null;
    if (amt && /(立替|立て替え|貸付|貸し付け)/.test(payParty + memo)) {
      out.push({ month, payParty, memo, amount: amt });
    }
  }
  return out;
}
