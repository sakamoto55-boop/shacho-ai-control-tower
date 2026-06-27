// Gmail読み取り専用クライアント
// 書き込み系処理（送信・返信・削除・ラベル変更・既読化等）は実装しない
import { mockGmailMessages } from './mockGmail'
import { mapToGmailDerivedTask } from './gmailMapper'
import type { GmailDerivedTask, GmailConnectionStatus, GmailFetchRange } from './types'

// 認証情報チェック（現時点では常にfalse）
function hasCredentials(): boolean {
  return false // GMAIL_CLIENT_ID等の環境変数が未設定
}

export function getConnectionStatus(): GmailConnectionStatus {
  return {
    connected: false,
    mode: hasCredentials() ? 'production' : 'demo',
    lastFetchAt: null,
    permission: '読み取り専用',
    writeEnabled: false,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  }
}

// 受信メール取得（読み取り専用）— 認証情報がない場合はmockを返す
export async function fetchInboxMessages(_range: GmailFetchRange = '24h'): Promise<GmailDerivedTask[]> {
  if (!hasCredentials()) {
    return mockGmailMessages.map(mapToGmailDerivedTask)
  }
  // 本番: Google Gmail API呼び出し（Phase 4-本番で実装）
  return []
}
