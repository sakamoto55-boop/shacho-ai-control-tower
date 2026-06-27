// Google Sheets API 取得型と内部変換型

export interface GoogleSpreadsheet {
  spreadsheetId: string
  properties: { title: string; locale: string }
  sheets: GoogleSheet[]
}

export interface GoogleSheet {
  properties: { sheetId: number; title: string; index: number }
}

export interface GoogleSheetValues {
  range: string
  majorDimension: 'ROWS' | 'COLUMNS'
  values: string[][]
}

export type SheetMetricKey =
  | 'monthly_revenue'
  | 'monthly_gross_profit'
  | 'gross_profit_rate'
  | 'cash_balance'
  | 'cashflow_13week'
  | 'receivable'
  | 'payable'
  | 'unbilled'
  | 'uncollected'
  | 'project_profit'
  | 'department_profit'
  | 'accident_count'
  | 'utilization_rate'
