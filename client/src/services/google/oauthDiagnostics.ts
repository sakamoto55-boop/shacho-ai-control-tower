// Google OAuth 接続診断（設定画面表示用）。
// アクセストークンや秘密情報そのものは返さない（画面に出さない）。
// スコープの有無・有効期限・各サービスの取得可否を判定する。

import { googleStorage } from './googleStorage'
import { googleToken } from './googleToken'
import { GOOGLE_SCOPES } from './googleScopes'

export interface ServiceAvailability {
  gmail: boolean
  calendar: boolean
  drive: boolean
  sheets: boolean
}

export interface OAuthDiagnostics {
  connected: boolean
  email: string | null
  scopes: string[] // 取得済みスコープ（表示可・秘密情報ではない）
  services: ServiceAvailability
  tokenValid: boolean
  expired: boolean
  expiresInMinutes: number | null
  needsReconnect: boolean
  reconnectReason: string | null
}

export function getOAuthDiagnostics(): OAuthDiagnostics {
  const connected = googleToken.hasToken()
  const scopeStr = googleStorage.getTokenScope()
  const scopes = scopeStr ? scopeStr.split(/\s+/).filter(Boolean) : []
  const email = googleStorage.getConnectedEmail()

  const has = (s: string) => scopes.includes(s)
  const services: ServiceAvailability = {
    gmail: has(GOOGLE_SCOPES.GMAIL_READONLY),
    calendar: has(GOOGLE_SCOPES.CALENDAR_READONLY),
    drive: has(GOOGLE_SCOPES.DRIVE_READONLY),
    sheets: has(GOOGLE_SCOPES.SHEETS_READONLY),
  }

  const expiry = googleStorage.getTokenExpiry()
  const tokenValid = connected && googleToken.isValid()
  const expired = connected && expiry > 0 && Date.now() >= expiry
  const expiresInMinutes = connected && expiry > 0 ? Math.max(0, Math.round((expiry - Date.now()) / 60000)) : null

  // 再接続が必要な条件
  let needsReconnect = false
  let reconnectReason: string | null = null
  if (!connected) {
    needsReconnect = true
    reconnectReason = 'Google未接続です。接続してください。'
  } else if (expired) {
    needsReconnect = true
    reconnectReason = 'アクセストークンが期限切れです。切断して再接続してください。'
  } else if (!(services.calendar && services.drive && services.sheets)) {
    needsReconnect = true
    reconnectReason = '一部のスコープが不足しています（以前のGmailのみ接続の可能性）。切断して4スコープで再接続してください。'
  }

  return {
    connected,
    email,
    scopes,
    services,
    tokenValid,
    expired,
    expiresInMinutes,
    needsReconnect,
    reconnectReason,
  }
}
