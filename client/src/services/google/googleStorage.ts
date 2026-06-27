// Google OAuth / Gmail データのローカルストレージ管理
// トークン保存 / PKCE コード保存 / メールキャッシュ / ログ

export interface AuthLogEntry {
  timestamp: string
  event:
    | 'oauth_start'
    | 'oauth_success'
    | 'oauth_error'
    | 'token_refresh'
    | 'fetch_start'
    | 'fetch_success'
    | 'fetch_error'
    | 'disconnect'
  detail: string
}

const KEYS = {
  ACCESS_TOKEN: 'gauth_access_token',
  REFRESH_TOKEN: 'gauth_refresh_token',
  TOKEN_EXPIRY: 'gauth_token_expiry',
  TOKEN_SCOPE: 'gauth_token_scope',
  CONNECTED_EMAIL: 'gauth_connected_email',
  PKCE_VERIFIER: 'gauth_pkce_verifier',
  PKCE_STATE: 'gauth_pkce_state',
  GMAIL_CACHE: 'gmail_msg_cache',
  GMAIL_CACHE_AT: 'gmail_cache_at',
  AUTH_LOG: 'gauth_log',
} as const

export const googleStorage = {
  // ── トークン ──

  saveTokens(params: {
    accessToken: string
    refreshToken: string | null
    expiresIn: number
    scope: string
    email?: string
  }): void {
    localStorage.setItem(KEYS.ACCESS_TOKEN, params.accessToken)
    if (params.refreshToken) {
      localStorage.setItem(KEYS.REFRESH_TOKEN, params.refreshToken)
    }
    localStorage.setItem(KEYS.TOKEN_EXPIRY, String(Date.now() + params.expiresIn * 1000))
    localStorage.setItem(KEYS.TOKEN_SCOPE, params.scope)
    if (params.email) {
      localStorage.setItem(KEYS.CONNECTED_EMAIL, params.email)
    }
  },

  getAccessToken(): string | null {
    return localStorage.getItem(KEYS.ACCESS_TOKEN)
  },

  getRefreshToken(): string | null {
    return localStorage.getItem(KEYS.REFRESH_TOKEN)
  },

  getTokenExpiry(): number {
    return Number(localStorage.getItem(KEYS.TOKEN_EXPIRY) ?? '0')
  },

  getTokenScope(): string {
    return localStorage.getItem(KEYS.TOKEN_SCOPE) ?? ''
  },

  getConnectedEmail(): string | null {
    return localStorage.getItem(KEYS.CONNECTED_EMAIL)
  },

  clearTokens(): void {
    localStorage.removeItem(KEYS.ACCESS_TOKEN)
    localStorage.removeItem(KEYS.REFRESH_TOKEN)
    localStorage.removeItem(KEYS.TOKEN_EXPIRY)
    localStorage.removeItem(KEYS.TOKEN_SCOPE)
    localStorage.removeItem(KEYS.CONNECTED_EMAIL)
  },

  // ── PKCE ──

  savePkce(verifier: string, state: string): void {
    sessionStorage.setItem(KEYS.PKCE_VERIFIER, verifier)
    sessionStorage.setItem(KEYS.PKCE_STATE, state)
  },

  getPkceVerifier(): string | null {
    return sessionStorage.getItem(KEYS.PKCE_VERIFIER)
  },

  getPkceState(): string | null {
    return sessionStorage.getItem(KEYS.PKCE_STATE)
  },

  clearPkce(): void {
    sessionStorage.removeItem(KEYS.PKCE_VERIFIER)
    sessionStorage.removeItem(KEYS.PKCE_STATE)
  },

  // ── Gmail キャッシュ ──

  saveGmailCache(data: unknown): void {
    try {
      localStorage.setItem(KEYS.GMAIL_CACHE, JSON.stringify(data))
      localStorage.setItem(KEYS.GMAIL_CACHE_AT, String(Date.now()))
    } catch {
      // ストレージ容量超過時は無視
    }
  },

  getRawGmailCache(): { data: unknown; cachedAt: number } | null {
    const raw = localStorage.getItem(KEYS.GMAIL_CACHE)
    const at = localStorage.getItem(KEYS.GMAIL_CACHE_AT)
    if (!raw || !at) return null
    try {
      return { data: JSON.parse(raw), cachedAt: Number(at) }
    } catch {
      return null
    }
  },

  clearGmailCache(): void {
    localStorage.removeItem(KEYS.GMAIL_CACHE)
    localStorage.removeItem(KEYS.GMAIL_CACHE_AT)
  },

  // ── ログ（最大50件） ──

  appendLog(entry: AuthLogEntry): void {
    const logs = [...this.getLogs(), entry].slice(-50)
    try {
      localStorage.setItem(KEYS.AUTH_LOG, JSON.stringify(logs))
    } catch {
      // ignore
    }
  },

  getLogs(): AuthLogEntry[] {
    const raw = localStorage.getItem(KEYS.AUTH_LOG)
    if (!raw) return []
    try {
      return JSON.parse(raw) as AuthLogEntry[]
    } catch {
      return []
    }
  },

  clearLogs(): void {
    localStorage.removeItem(KEYS.AUTH_LOG)
  },
}
