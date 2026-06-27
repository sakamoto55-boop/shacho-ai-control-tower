// Google OAuth 認証フロー（Authorization Code + PKCE）
// 書き込み処理は一切実装しない。ReadOnly スコープのみ使用。

import { googleStorage } from './googleStorage'
import { googleToken, type GoogleTokenResponse } from './googleToken'
import { GoogleAuthError } from './googleErrors'
import { PHASE5_SCOPES } from './googleScopes'

// ── PKCE ユーティリティ ──

function base64urlEncode(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64urlEncode(array)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64urlEncode(new Uint8Array(digest))
}

function generateState(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return base64urlEncode(array)
}

function getRedirectUri(): string {
  return (import.meta.env.VITE_GOOGLE_REDIRECT_URI as string | undefined)
    ?? `${window.location.origin}/`
}

// ── OAuth フロー ──

export const googleAuth = {
  // OAuth 認証フローを開始（Google ログイン画面へリダイレクト）
  async startOAuthFlow(): Promise<void> {
    const clientId = import.meta.env.VITE_GMAIL_CLIENT_ID as string | undefined
    if (!clientId) {
      throw new GoogleAuthError(
        'NOT_CONFIGURED',
        'VITE_GMAIL_CLIENT_ID が未設定です。client/.env を確認してください。',
      )
    }

    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = generateState()

    googleStorage.savePkce(verifier, state)
    googleStorage.appendLog({
      timestamp: new Date().toISOString(),
      event: 'oauth_start',
      detail: `OAuth認証フロー開始（PKCE / scope=${PHASE5_SCOPES.join(',')}）`,
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: getRedirectUri(),
      scope: PHASE5_SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
    })

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  },

  // OAuth コールバック処理（URL の ?code=... を処理）
  async handleCallback(code: string, returnedState: string): Promise<{ email: string }> {
    // CSRF 対策: state 検証
    const storedState = googleStorage.getPkceState()
    if (!storedState || storedState !== returnedState) {
      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'oauth_error',
        detail: 'state パラメータの不一致（CSRF対策）',
      })
      throw new GoogleAuthError('STATE_MISMATCH', 'セキュリティ検証に失敗しました（state不一致）')
    }

    const verifier = googleStorage.getPkceVerifier()
    if (!verifier) {
      throw new GoogleAuthError('AUTH_FAILED', 'PKCE コードベリファイアが見つかりません')
    }

    const clientId = import.meta.env.VITE_GMAIL_CLIENT_ID as string | undefined
    if (!clientId) {
      throw new GoogleAuthError('NOT_CONFIGURED', 'VITE_GMAIL_CLIENT_ID が未設定です')
    }

    try {
      // コードとトークンを交換
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: getRedirectUri(),
        }),
      })

      if (!tokenRes.ok) {
        const err = (await tokenRes.json()) as { error_description?: string; error?: string }
        throw new GoogleAuthError(
          'TOKEN_EXCHANGE_FAILED',
          err.error_description ?? err.error ?? 'トークン取得に失敗しました',
        )
      }

      const tokens = (await tokenRes.json()) as GoogleTokenResponse

      // ユーザー情報を取得してメールアドレスを確認
      let email = ''
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        if (userRes.ok) {
          const user = (await userRes.json()) as { email?: string }
          email = user.email ?? ''
        }
      } catch {
        // userinfo 取得失敗は無視（必須ではない）
      }

      googleToken.save(tokens, email)
      googleStorage.clearPkce()

      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'oauth_success',
        detail: `OAuth認証成功 email=${email} scope=${tokens.scope}`,
      })

      return { email }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'oauth_error',
        detail: msg,
      })
      throw e
    }
  },

  // 接続を解除（トークン・キャッシュ削除）
  disconnect(): void {
    googleStorage.appendLog({
      timestamp: new Date().toISOString(),
      event: 'disconnect',
      detail: 'Googleアカウント接続を解除',
    })
    googleToken.clear()
    googleStorage.clearGmailCache()
  },

  // 現在接続済みかどうか
  isConnected(): boolean {
    return googleToken.hasToken()
  },
}
