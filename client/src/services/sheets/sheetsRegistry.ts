// 読み取り対象シートの定義（本番シートIDは環境変数で管理）
// 実際のシートIDやURLはここに書かない

export interface SheetTarget {
  envKey: string
  name: string
  range: string
  description: string
}

export const SHEET_TARGETS: SheetTarget[] = [
  {
    envKey: 'VITE_GOOGLE_SHEETS_SALES_ID',
    name: '売上管理シート',
    range: 'A1:Z100',
    description: '今月売上・粗利・粗利率',
  },
  {
    envKey: 'VITE_GOOGLE_SHEETS_CASHFLOW_ID',
    name: '資金繰り表',
    range: 'A1:Z14',
    description: '13週資金繰り・現金残高・入金・支払',
  },
  {
    envKey: 'VITE_GOOGLE_SHEETS_PROJECT_PROFIT_ID',
    name: '案件別粗利',
    range: 'A1:Z50',
    description: '案件別粗利ランキング',
  },
  {
    envKey: 'VITE_GOOGLE_SHEETS_RECEIVABLE_ID',
    name: '売掛管理',
    range: 'A1:Z100',
    description: '未回収・入金予定',
  },
  {
    envKey: 'VITE_GOOGLE_SHEETS_PAYABLE_ID',
    name: '買掛管理',
    range: 'A1:Z100',
    description: '支払予定・未請求',
  },
]

export function getSheetId(envKey: string): string | null {
  const value = import.meta.env[envKey]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function hasAllSheetIds(): boolean {
  return SHEET_TARGETS.every((t) => getSheetId(t.envKey) !== null)
}
