// LINE WORKS クライアント（読み取りのみ）
// 送信・既読化・削除等の書き込み操作は一切提供しない

import type { LineWorksNotificationMessage, LineWorksInboxMessage } from './types'
import { mockLineWorksNotifications, mockLineWorksInboxMessages } from './mockLineworks'
import { lineworksCache } from './lineworksCache'
import { googleToken } from '../google/googleToken'

const hasBotId = (): boolean => !!import.meta.env.VITE_LINEWORKS_BOT_ID
const hasDomainId = (): boolean => !!import.meta.env.VITE_LINEWORKS_DOMAIN_ID

interface FetchResult<T> {
  data: T
  source: 'mock' | 'cache' | 'api' | 'unconfigured'
}

export const lineworksClient = {
  async fetchNotifications(): Promise<FetchResult<LineWorksNotificationMessage[]>> {
    // キャッシュ確認
    const cached = lineworksCache.get<LineWorksNotificationMessage[]>()
    if (cached) return { data: cached, source: 'cache' }

    // 本番API接続は未実装（フロントエンドへの秘密鍵配置禁止）
    if (hasBotId() && hasDomainId()) {
      // 将来: バックエンドProxy経由でfetch
      // const data = await lineworksFetcher.getMessages(...)
    }

    return googleToken.hasToken() ? { data: [], source: 'unconfigured' } : { data: mockLineWorksNotifications, source: 'mock' }
  },

  async fetchInboxMessages(): Promise<FetchResult<LineWorksInboxMessage[]>> {
    return googleToken.hasToken() ? { data: [], source: 'unconfigured' } : { data: mockLineWorksInboxMessages, source: 'mock' }
  },

  async refresh(): Promise<void> {
    lineworksCache.clear()
  },

  isUsingMock(): boolean {
    return !hasBotId() || !hasDomainId()
  },
}
