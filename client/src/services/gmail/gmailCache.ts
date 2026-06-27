// Gmail メッセージのローカルキャッシュ管理
// 5分間有効。期限切れ or 手動クリアで再取得。

import type { GmailMessage } from './types'
import { googleStorage } from '../google/googleStorage'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5分

export const gmailCache = {
  get(): GmailMessage[] | null {
    const raw = googleStorage.getRawGmailCache()
    if (!raw) return null
    if (Date.now() - raw.cachedAt > CACHE_TTL_MS) return null // 期限切れ

    try {
      const arr = raw.data as Array<Record<string, unknown>>
      return arr.map((m) => ({
        ...m,
        date: new Date(m.date as string),
        writeProtected: true as const,
      })) as GmailMessage[]
    } catch {
      return null
    }
  },

  set(messages: GmailMessage[]): void {
    googleStorage.saveGmailCache(messages)
  },

  isStale(): boolean {
    const raw = googleStorage.getRawGmailCache()
    if (!raw) return true
    return Date.now() - raw.cachedAt > CACHE_TTL_MS
  },

  clear(): void {
    googleStorage.clearGmailCache()
  },

  getLastFetchedAt(): Date | null {
    const raw = googleStorage.getRawGmailCache()
    if (!raw) return null
    return new Date(raw.cachedAt)
  },
}
