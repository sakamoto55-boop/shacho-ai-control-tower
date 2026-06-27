// Google OAuth トークン管理
// アクセストークンの有効性確認・保存・リフレッシュ

import { googleStorage } from './googleStorage'
import { GoogleAuthError } from './googleErrors'

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 期限5分前にリフレッシュ

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

export const googleToken = {
  // アクセストークンが現在有効かどうか
  isValid(): boolean {
    const token = googleStorage.getAccessToken()
    if (!token) return false
    const expiry = googleStorage.getTokenExpiry()
    return Date.now() < expiry - REFRESH_BUFFER_MS
  },

  // トークンがある（有効期限問わず）
  hasToken(): boolean {
    return !!googleStorage.getAccessToken()
  },

  // 有効なトークンを返す（なければ例外）
  getOrThrow(): string {
    const token = googleStorage.getAccessToken()
    if (!token) {
      throw new GoogleAuthError('TOKEN_EXPIRED', 'アクセストークンがありません。再接続してください。')
    }
    if (!this.isValid()) {
      throw new GoogleAuthError('TOKEN_EXPIRED', 'アクセストークンが期限切れです。再接続してください。')
    }
    return token
  },

  // トークンレスポンスを保存
  save(response: GoogleTokenResponse, email?: string): void {
    googleStorage.saveTokens({
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      expiresIn: response.expires_in,
      scope: response.scope,
      email,
    })
  },

  // トークンを削除（切断時）
  clear(): void {
    googleStorage.clearTokens()
  },

  // リフレッシュトークンでアクセストークンを更新
  async refresh(): Promise<boolean> {
    const refreshToken = googleStorage.getRefreshToken()
    const clientId = import.meta.env.VITE_GMAIL_CLIENT_ID as string | undefined
    if (!refreshToken || !clientId) return false

    googleStorage.appendLog({
      timestamp: new Date().toISOString(),
      event: 'token_refresh',
      detail: 'アクセストークンのリフレッシュ開始',
    })

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      })
      if (!res.ok) return false

      const data = (await res.json()) as GoogleTokenResponse
      googleStorage.saveTokens({
        accessToken: data.access_token,
        refreshToken: refreshToken,
        expiresIn: data.expires_in,
        scope: data.scope,
      })

      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'token_refresh',
        detail: 'アクセストークンのリフレッシュ成功',
      })
      return true
    } catch {
      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'oauth_error',
        detail: 'トークンリフレッシュ失敗',
      })
      return false
    }
  },
}
