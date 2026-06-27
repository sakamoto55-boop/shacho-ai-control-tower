// Gmail 読み取り専用クライアント
// 書き込み処理（送信・返信・下書き作成・削除・ラベル変更・既読化・スター付与等）は一切実装しない

import { mockGmailMessages } from './mockGmail'
import { mapToGmailDerivedTask } from './gmailMapper'
import { gmailFetcher } from './gmailFetcher'
import { gmailCache } from './gmailCache'
import { googleToken } from '../google/googleToken'
import { googleStorage } from '../google/googleStorage'
import type { GmailMessage, GmailDerivedTask, GmailConnectionStatus, GmailFetchRange } from './types'

// 接続状態を返す（常に読み取り専用 / 書き込みなし）
export function getConnectionStatus(): GmailConnectionStatus {
  return {
    connected: false,
    mode: googleToken.hasToken() ? 'production' : 'demo',
    lastFetchAt: gmailCache.getLastFetchedAt(),
    permission: '読み取り専用',
    writeEnabled: false,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  }
}

// 生のGmailメッセージを取得（キャッシュ優先）
// 認証済み → 本番 Gmail API。未認証 → mockGmail
export async function fetchRawMessages(): Promise<GmailMessage[]> {
  if (!googleToken.hasToken()) {
    return mockGmailMessages
  }

  // キャッシュが有効なら返す（毎回 Google API を呼ばない）
  const cached = gmailCache.get()
  if (cached) {
    return cached
  }

  // 有効なトークンで Gmail API を呼び出す
  const accessToken = googleToken.getOrThrow()
  const messages = await gmailFetcher.fetchMessages(accessToken)
  gmailCache.set(messages)
  return messages
}

// タスク形式で取得（既存コンポーネントとの互換性）
export async function fetchInboxMessages(_range: GmailFetchRange = '24h'): Promise<GmailDerivedTask[]> {
  const messages = await fetchRawMessages()
  return messages.map(mapToGmailDerivedTask)
}

// キャッシュをクリアして再取得（手動リフレッシュ用）
export async function refreshMessages(): Promise<GmailMessage[]> {
  gmailCache.clear()
  return fetchRawMessages()
}

// 認証ログ取得（設定画面に表示）
export function getAuthLogs() {
  return googleStorage.getLogs()
}

// キャッシュの最終取得日時
export function getCacheLastFetchedAt(): Date | null {
  return gmailCache.getLastFetchedAt()
}
