// Google OAuth スコープ定義
// Phase 5: Gmail ReadOnly のみ
// Drive / Calendar / Sheets / LINE WORKS は未接続

export const GOOGLE_SCOPES = {
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
} as const

export type GoogleScope = (typeof GOOGLE_SCOPES)[keyof typeof GOOGLE_SCOPES]

// Phase 5 で使用するスコープ（ReadOnly のみ）
export const PHASE5_SCOPES: GoogleScope[] = [GOOGLE_SCOPES.GMAIL_READONLY]

// 未来フェーズ予定スコープ（現時点では使用しない）
export const FUTURE_SCOPES = {
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly', // Phase 6予定
  DRIVE_READONLY: 'https://www.googleapis.com/auth/drive.readonly',        // 未定
  SHEETS_READONLY: 'https://www.googleapis.com/auth/spreadsheets.readonly', // 未定
} as const

export function getScopeLabel(scope: string): string {
  switch (scope) {
    case GOOGLE_SCOPES.GMAIL_READONLY:
      return 'Gmail 読み取り専用'
    case FUTURE_SCOPES.CALENDAR_READONLY:
      return 'Googleカレンダー 読み取り専用（未取得）'
    case FUTURE_SCOPES.DRIVE_READONLY:
      return 'Google Drive 読み取り専用（未取得）'
    default:
      return scope
  }
}
