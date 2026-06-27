// Google OAuth セッション状態管理
// localStorage をベースにした状態読み書き（React 非依存）

import { googleStorage } from './googleStorage'
import { googleToken } from './googleToken'
import { GOOGLE_SCOPES } from './googleScopes'
import type { AuthLogEntry } from './googleStorage'

export type GoogleConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface GoogleSession {
  status: GoogleConnectionStatus
  connectedEmail: string | null
  grantedScopes: string[]
  lastError: string | null
  lastAuthAt: string | null  // ISO string
  recentLogs: AuthLogEntry[]
}

const STATUS_KEY = 'gauth_status'
const ERROR_KEY = 'gauth_last_error'

export const googleSession = {
  get(): GoogleSession {
    const hasToken = googleToken.hasToken()
    const rawStatus = localStorage.getItem(STATUS_KEY) as GoogleConnectionStatus | null

    // トークンがなければ disconnected に戻す
    const status: GoogleConnectionStatus = !hasToken
      ? 'disconnected'
      : (rawStatus ?? 'disconnected')

    const scope = googleStorage.getTokenScope()
    const grantedScopes: string[] = []
    if (scope.includes(GOOGLE_SCOPES.GMAIL_READONLY)) {
      grantedScopes.push(GOOGLE_SCOPES.GMAIL_READONLY)
    }

    return {
      status,
      connectedEmail: googleStorage.getConnectedEmail(),
      grantedScopes,
      lastError: localStorage.getItem(ERROR_KEY),
      lastAuthAt: hasToken
        ? new Date(googleStorage.getTokenExpiry() - 3600 * 1000).toISOString()
        : null,
      recentLogs: googleStorage.getLogs().slice(-10),
    }
  },

  setConnecting(): void {
    localStorage.setItem(STATUS_KEY, 'connecting')
  },

  setConnected(): void {
    localStorage.setItem(STATUS_KEY, 'connected')
    localStorage.removeItem(ERROR_KEY)
  },

  setError(message: string): void {
    localStorage.setItem(STATUS_KEY, 'error')
    localStorage.setItem(ERROR_KEY, message)
  },

  clear(): void {
    localStorage.removeItem(STATUS_KEY)
    localStorage.removeItem(ERROR_KEY)
  },
}
