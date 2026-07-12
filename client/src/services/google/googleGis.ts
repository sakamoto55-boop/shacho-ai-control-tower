// Google Identity Services（GIS）トークンモデルによるブラウザ専用認証。
// - Client Secret 不要・バックエンド不要・リダイレクト不要（サブパスの301問題を回避）
// - JavaScript生成元（承認済みオリジン）だけで動作する（redirect_uri は使わない）
// - 取得するのは readonly 4スコープのアクセストークンのみ（書き込みなし）
//
// 従来の Authorization Code + PKCE（client-side交換）は Google の「ウェブアプリ」型
// クライアントでは client_secret を要求するため、フロント単独では成立しない。
// そのため GIS トークンモデルへ切り替える。

import { googleToken } from './googleToken'
import { googleStorage } from './googleStorage'
import { GOOGLE_REAL_SCOPES } from './googleScopes'
import { GoogleAuthError } from './googleErrors'

interface GisTokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}
interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
}
interface GisOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (resp: GisTokenResponse) => void
    error_callback?: (err: { type?: string; message?: string }) => void
  }) => GisTokenClient
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } }
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let scriptPromise: Promise<void> | null = null

// GISスクリプトを一度だけ読み込む
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () =>
      reject(new GoogleAuthError('NETWORK_ERROR', 'Google認証スクリプト(gsi/client)の読み込みに失敗しました。ネットワークをご確認ください。'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return ''
    const user = (await res.json()) as { email?: string }
    return user.email ?? ''
  } catch {
    return ''
  }
}

export const googleGis = {
  isSupported(): boolean {
    return typeof window !== 'undefined'
  },

  // トークン取得（ポップアップ）。成功で access_token を保存し email を返す。
  async connect(): Promise<{ email: string }> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
    if (!clientId) {
      throw new GoogleAuthError('NOT_CONFIGURED', 'VITE_GOOGLE_CLIENT_ID が未設定です。')
    }

    await loadGis()
    const oauth2 = window.google?.accounts?.oauth2
    if (!oauth2) {
      throw new GoogleAuthError('NETWORK_ERROR', 'Google認証(GIS)が初期化できませんでした。')
    }

    googleStorage.appendLog({
      timestamp: new Date().toISOString(),
      event: 'oauth_start',
      detail: `GISトークン取得開始 scope=${GOOGLE_REAL_SCOPES.join(',')}`,
    })

    return new Promise<{ email: string }>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_REAL_SCOPES.join(' '),
        callback: (resp: GisTokenResponse) => {
          if (resp.error || !resp.access_token) {
            const msg = resp.error_description || resp.error || 'アクセストークンを取得できませんでした'
            googleStorage.appendLog({ timestamp: new Date().toISOString(), event: 'oauth_error', detail: `GIS失敗: ${msg}` })
            reject(new GoogleAuthError('TOKEN_EXCHANGE_FAILED', `Google認証に失敗しました（${msg}）`))
            return
          }
          void (async () => {
            const email = await fetchEmail(resp.access_token!)
            googleToken.save(
              {
                access_token: resp.access_token!,
                expires_in: resp.expires_in ?? 3600,
                scope: resp.scope ?? GOOGLE_REAL_SCOPES.join(' '),
                token_type: resp.token_type ?? 'Bearer',
              },
              email,
            )
            googleStorage.appendLog({
              timestamp: new Date().toISOString(),
              event: 'oauth_success',
              detail: `GIS認証成功 email=${email} scope=${resp.scope ?? ''}`,
            })
            resolve({ email })
          })()
        },
        error_callback: (err) => {
          const type = err?.type ?? 'error'
          googleStorage.appendLog({ timestamp: new Date().toISOString(), event: 'oauth_error', detail: `GIS error_callback: ${type}` })
          reject(new GoogleAuthError('AUTH_FAILED', `認証がキャンセルまたは失敗しました（${type}）`))
        },
      })
      client.requestAccessToken()
    })
  },
}
