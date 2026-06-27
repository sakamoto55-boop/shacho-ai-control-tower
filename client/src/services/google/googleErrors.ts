// Google OAuth / API エラー定義

export type GoogleAuthErrorCode =
  | 'NOT_CONFIGURED'        // VITE_GMAIL_CLIENT_ID が未設定
  | 'AUTH_FAILED'           // 認証失敗（ユーザーキャンセル等）
  | 'STATE_MISMATCH'        // CSRF対策 state 不一致
  | 'TOKEN_EXCHANGE_FAILED' // コードとトークンの交換失敗
  | 'TOKEN_EXPIRED'         // アクセストークン期限切れ
  | 'REFRESH_FAILED'        // リフレッシュトークンでの更新失敗
  | 'PERMISSION_DENIED'     // 必要な権限が付与されていない
  | 'NETWORK_ERROR'         // ネットワークエラー
  | 'REVOKED'               // 認証が取り消された

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: GoogleAuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

export function getErrorMessage(code: GoogleAuthErrorCode): string {
  const messages: Record<GoogleAuthErrorCode, string> = {
    NOT_CONFIGURED: 'Google Client IDが未設定です。.envを確認してください。',
    AUTH_FAILED: '認証に失敗しました。もう一度お試しください。',
    STATE_MISMATCH: 'セキュリティ検証に失敗しました。再度お試しください。',
    TOKEN_EXCHANGE_FAILED: 'トークン取得に失敗しました。Client IDとリダイレクトURIを確認してください。',
    TOKEN_EXPIRED: 'セッションが期限切れです。再接続してください。',
    REFRESH_FAILED: 'セッションの更新に失敗しました。再接続してください。',
    PERMISSION_DENIED: 'Gmail読み取り権限が付与されていません。',
    NETWORK_ERROR: 'ネットワークエラーが発生しました。接続を確認してください。',
    REVOKED: 'Googleアカウントの接続が解除されました。再接続してください。',
  }
  return messages[code]
}
