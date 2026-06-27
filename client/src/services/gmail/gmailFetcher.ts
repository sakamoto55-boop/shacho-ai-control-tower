// Gmail API 読み取り専用フェッチャー
// 書き込み処理（送信・返信・下書き・削除・ラベル変更・既読化等）は実装しない

import type { GmailMessage } from './types'
import { googleStorage } from '../google/googleStorage'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// 既定の検索クエリ（受信トレイ・未読・過去3日）
const DEFAULT_QUERY = 'is:unread newer_than:3d'
const MAX_RESULTS = 20

interface GmailApiListMessage {
  id: string
  threadId: string
}

interface GmailApiMessageDetail {
  id: string
  threadId: string
  snippet: string
  labelIds?: string[]
  payload?: {
    headers?: Array<{ name: string; value: string }>
    body?: { data?: string; size?: number }
    parts?: Array<{
      mimeType: string
      filename?: string
      body?: { data?: string }
    }>
  }
  internalDate?: string
}

function getHeader(detail: GmailApiMessageDetail, name: string): string {
  return (
    detail.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  )
}

function decodeBase64(encoded: string): string {
  try {
    return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return ''
  }
}

function extractBodyText(detail: GmailApiMessageDetail): string {
  // multipart: text/plain パートを探す
  const textPart = detail.payload?.parts?.find((p) => p.mimeType === 'text/plain')
  if (textPart?.body?.data) {
    return decodeBase64(textPart.body.data).slice(0, 2000)
  }
  // シングルパート
  const bodyData = detail.payload?.body?.data
  if (bodyData) {
    return decodeBase64(bodyData).slice(0, 2000)
  }
  return detail.snippet ?? ''
}

function checkHasAttachment(detail: GmailApiMessageDetail): boolean {
  return (
    detail.payload?.parts?.some((p) => typeof p.filename === 'string' && p.filename.length > 0) ??
    false
  )
}

export const gmailFetcher = {
  // Gmail API からメッセージを読み取り取得
  // 書き込み処理は存在しない
  async fetchMessages(
    accessToken: string,
    query = DEFAULT_QUERY,
    maxResults = MAX_RESULTS,
  ): Promise<GmailMessage[]> {
    const startTime = Date.now()

    googleStorage.appendLog({
      timestamp: new Date().toISOString(),
      event: 'fetch_start',
      detail: `Gmail取得開始 query="${query}" maxResults=${maxResults}`,
    })

    // 1. メッセージ ID 一覧を取得
    const listRes = await fetch(
      `${GMAIL_API}/messages?${new URLSearchParams({
        q: query,
        maxResults: String(maxResults),
      })}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )

    if (!listRes.ok) {
      const errBody = await listRes.json().catch(() => ({})) as { error?: { message?: string } }
      const detail = errBody?.error?.message ?? `HTTP ${listRes.status}`
      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'fetch_error',
        detail: `メッセージ一覧取得失敗: ${detail}`,
      })
      throw new Error(`Gmail一覧取得エラー: ${detail}`)
    }

    const listData = (await listRes.json()) as { messages?: GmailApiListMessage[] }
    const ids = (listData.messages ?? []).map((m) => m.id)

    if (ids.length === 0) {
      googleStorage.appendLog({
        timestamp: new Date().toISOString(),
        event: 'fetch_success',
        detail: `取得件数: 0件 (${Date.now() - startTime}ms)`,
      })
      return []
    }

    // 2. 各メッセージの詳細を並列取得（最大10件）
    const details = await Promise.all(
      ids.slice(0, 10).map(async (id): Promise<GmailApiMessageDetail | null> => {
        const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) return null
        return res.json() as Promise<GmailApiMessageDetail>
      }),
    )

    const messages: GmailMessage[] = details
      .filter((d): d is GmailApiMessageDetail => d !== null)
      .map((detail) => {
        const fromRaw = getHeader(detail, 'from')
        const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/)

        return {
          id: detail.id,
          threadId: detail.threadId,
          subject: getHeader(detail, 'subject') || '(件名なし)',
          from: fromMatch ? (fromMatch[1].trim() || fromMatch[2]) : fromRaw,
          fromEmail: fromMatch ? fromMatch[2] : fromRaw,
          date: detail.internalDate ? new Date(Number(detail.internalDate)) : new Date(),
          snippet: detail.snippet ?? '',
          body: extractBodyText(detail),
          hasAttachment: checkHasAttachment(detail),
          isUnread: detail.labelIds?.includes('UNREAD') ?? false,
          labels: detail.labelIds ?? [],
          writeProtected: true,
        }
      })

    googleStorage.appendLog({
      timestamp: new Date().toISOString(),
      event: 'fetch_success',
      detail: `取得件数: ${messages.length}件 (${Date.now() - startTime}ms)`,
    })

    return messages
  },
}
