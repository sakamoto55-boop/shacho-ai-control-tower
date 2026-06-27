// OAuth接続前チェック — 本番接続前に満たすべき条件を検証する

export interface OAuthPreConnectCheck {
  hasClientId: boolean
  hasRedirectUri: boolean
  scope: string
  isReadOnly: boolean
  hasWriteScope: false
  writeApiImplemented: false
  isReadyToConnect: boolean
  redirectUri: string
  clientIdMasked: string | null
}

export function getOAuthPreConnectCheck(): OAuthPreConnectCheck {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
  const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI ?? window.location.origin + '/'
  const scope = import.meta.env.VITE_GOOGLE_SCOPES ?? 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly'

  const hasClientId = typeof clientId === 'string' && clientId.trim().length > 0
  const hasRedirectUri = typeof redirectUri === 'string' && redirectUri.trim().length > 0

  let clientIdMasked: string | null = null
  if (hasClientId) {
    // 末尾8文字だけ見せ、それ以前を *** でマスク
    const trimmed = clientId.trim()
    clientIdMasked = trimmed.length > 8
      ? '****' + trimmed.slice(-8)
      : '****'
  }

  return {
    hasClientId,
    hasRedirectUri,
    scope,
    isReadOnly: true,
    hasWriteScope: false,
    writeApiImplemented: false,
    isReadyToConnect: hasClientId && hasRedirectUri,
    redirectUri,
    clientIdMasked,
  }
}
