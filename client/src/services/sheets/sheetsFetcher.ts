// Google Sheets ReadOnly フェッチャー
// GET 専用 — セル更新・行追加・削除系は完全未実装

import type { GoogleSpreadsheet, GoogleSheetValues } from './types'

export async function fetchSpreadsheet(
  accessToken: string,
  spreadsheetId: string
): Promise<GoogleSpreadsheet> {
  // updateCell / appendRow / deleteRow / createSheet / deleteSheet /
  // shareSheet / changePermission / formatCell — 完全未実装
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Sheets API error: ${err.error?.message ?? resp.status}`)
  }
  return resp.json() as Promise<GoogleSpreadsheet>
}

export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<GoogleSheetValues> {
  // updateCell / appendRow / deleteRow — 完全未実装
  const encoded = encodeURIComponent(range)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encoded}?majorDimension=ROWS`
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Sheets values API error: ${err.error?.message ?? resp.status}`)
  }
  return resp.json() as Promise<GoogleSheetValues>
}

// 以下は完全未実装（書き込み禁止）
// updateCell() — 未実装
// appendRow() — 未実装
// deleteRow() — 未実装
// createSheet() — 未実装
// deleteSheet() — 未実装
// shareSheet() — 未実装
// changePermission() — 未実装
// formatCell() — 未実装
