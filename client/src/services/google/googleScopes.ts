// Google OAuth スコープ定義
// Phase 5: Gmail ReadOnly
// Phase 6: Calendar ReadOnly を追加
// Phase 7: Drive ReadOnly を追加
// Sheets / LINE WORKS は未接続
//
// 書き込みスコープは絶対に追加しない
// gmail.modify / gmail.send / calendar.events / drive / sheets は禁止

export const GOOGLE_SCOPES = {
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  DRIVE_READONLY: 'https://www.googleapis.com/auth/drive.readonly',
} as const

export type GoogleScope = (typeof GOOGLE_SCOPES)[keyof typeof GOOGLE_SCOPES]

// Phase 5 で使用するスコープ（Gmail ReadOnly のみ）
export const PHASE5_SCOPES: GoogleScope[] = [GOOGLE_SCOPES.GMAIL_READONLY]

// Phase 6 で使用するスコープ（Gmail + Calendar ReadOnly）
// 書き込みスコープは含まない
export const PHASE6_SCOPES: GoogleScope[] = [
  GOOGLE_SCOPES.GMAIL_READONLY,
  GOOGLE_SCOPES.CALENDAR_READONLY,
]

// Phase 7 で使用するスコープ（Gmail + Calendar + Drive ReadOnly）
// 書き込みスコープは含まない
export const PHASE7_SCOPES: GoogleScope[] = [
  GOOGLE_SCOPES.GMAIL_READONLY,
  GOOGLE_SCOPES.CALENDAR_READONLY,
  GOOGLE_SCOPES.DRIVE_READONLY,
]

// 将来フェーズ予定スコープ（現時点では使用しない）
export const FUTURE_SCOPES = {
  SHEETS_READONLY: 'https://www.googleapis.com/auth/spreadsheets.readonly', // Phase 8予定
} as const

// 絶対に使用してはいけないスコープ（書き込み禁止）
export const FORBIDDEN_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
] as const

export function getScopeLabel(scope: string): string {
  switch (scope) {
    case GOOGLE_SCOPES.GMAIL_READONLY:
      return 'Gmail 読み取り専用'
    case GOOGLE_SCOPES.CALENDAR_READONLY:
      return 'Googleカレンダー 読み取り専用'
    case GOOGLE_SCOPES.DRIVE_READONLY:
      return 'Google Drive 読み取り専用'
    default:
      return scope
  }
}

export function hasWriteScope(scopes: string[]): boolean {
  return scopes.some((s) => (FORBIDDEN_SCOPES as readonly string[]).includes(s))
}
