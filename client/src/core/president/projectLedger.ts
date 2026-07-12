// 進行中プロジェクト（案件台帳）の設定と解析。
// - 設定（スプレッドシートID・シート名・列名マッピング）は localStorage に保存
// - 認証情報は保存しない
// - 列は「ヘッダー名」で判定（列順固定ではない）
// - 列名不一致は画面を止めず、設定エラーを返す
// - 読み取り専用

export interface LedgerColumnMap {
  projectName: string // 案件名列（必須）
  assignee: string // 担当者列
  status: string // ステータス列
  revenue: string // 売上列
  cost: string // 原価列
  grossProfit: string // 粗利列
  deadline: string // 期限列
  updatedAt: string // 最終更新列
}

export interface LedgerConfig {
  spreadsheetId: string
  sheetName: string
  columns: LedgerColumnMap
}

export interface LedgerProject {
  projectName: string
  assignee: string
  status: string
  revenue: string
  cost: string
  grossProfit: string
  deadline: string
  updatedAt: string
}

export type LedgerParseResult =
  | { ok: true; projects: LedgerProject[] }
  | { ok: false; error: string; missing: string[] }

const STORAGE_KEY = 'president_project_ledger_config'

export function loadLedgerConfig(): LedgerConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as LedgerConfig
    if (!cfg.spreadsheetId || !cfg.sheetName) return null
    return cfg
  } catch {
    return null
  }
}

export function saveLedgerConfig(cfg: LedgerConfig): void {
  // 認証情報は保存しない（ID・シート名・列名のみ）
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

export function clearLedgerConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

function findIndex(header: string[], name: string): number {
  if (!name) return -1
  const norm = (s: string) => s.trim().toLowerCase()
  return header.findIndex((h) => norm(h) === norm(name))
}

// values（1行目ヘッダー）を列名マッピングで LedgerProject[] に変換する。
// 案件名列が見つからない場合は設定エラーを返す（画面は止めない）。
export function parseLedger(values: string[][], cfg: LedgerConfig): LedgerParseResult {
  const rows = values ?? []
  if (rows.length === 0) return { ok: false, error: 'シートにデータがありません', missing: [] }

  const header = rows[0]
  const c = cfg.columns

  const idxName = findIndex(header, c.projectName)
  if (idxName === -1) {
    return { ok: false, error: `案件名列「${c.projectName || '(未設定)'}」がヘッダーに見つかりません`, missing: [c.projectName || '案件名'] }
  }

  const missing: string[] = []
  const idx = (name: string, labelForMissing?: string): number => {
    const i = findIndex(header, name)
    if (i === -1 && name && labelForMissing) missing.push(labelForMissing)
    return i
  }
  const iAssignee = idx(c.assignee, '担当者')
  const iStatus = idx(c.status, 'ステータス')
  const iRevenue = idx(c.revenue, '売上')
  const iCost = idx(c.cost, '原価')
  const iGross = idx(c.grossProfit, '粗利')
  const iDeadline = idx(c.deadline, '期限')
  const iUpdated = idx(c.updatedAt, '最終更新')

  const get = (row: string[], i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '')

  const projects: LedgerProject[] = rows.slice(1)
    .filter((row) => get(row, idxName) !== '')
    .map((row) => ({
      projectName: get(row, idxName),
      assignee: get(row, iAssignee),
      status: get(row, iStatus),
      revenue: get(row, iRevenue),
      cost: get(row, iCost),
      grossProfit: get(row, iGross),
      deadline: get(row, iDeadline),
      updatedAt: get(row, iUpdated),
    }))

  // 案件名は取れているので ok。任意列の欠落は missing に載せるが致命的にはしない。
  return { ok: true, projects }
}
