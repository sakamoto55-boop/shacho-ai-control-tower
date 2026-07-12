// LINE WORKS 通知Provider（Phase 9）
// 読み取り専用 — 送信・既読化・削除は行わない

import type { ProviderDescriptor, UnifiedNotification } from './providerTypes'
import { lineworksClient } from '../../services/lineworks/lineworksClient'
import { mapLineWorksToUnifiedNotification } from '../../services/lineworks/lineworksMapper'

export const notificationProvider = {
  getDescriptor(): ProviderDescriptor {
    return {
      providerId: 'lineworks-notification',
      providerName: 'LINE WORKS 通知',
      providerType: 'notification',
      sourceService: 'LINE WORKS',
      connectionStatus: 'demo',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: lineworksClient.isUsingMock() ? 'degraded' : 'healthy',
      errors: [],
      warnings: lineworksClient.isUsingMock()
        ? ['LINE WORKS本番未接続。デモデータを使用しています。']
        : [],
      nextPhase: 'Phase 10: LINE WORKS Webhook受信 / OAuth2本番接続',
    }
  },

  async getItems(): Promise<UnifiedNotification[]> {
    const result = await lineworksClient.fetchNotifications()
    return result.data.map(mapLineWorksToUnifiedNotification)
  },

  async refresh(): Promise<void> {
    await lineworksClient.refresh()
  },

  isUsingDemo(): boolean {
    return lineworksClient.isUsingMock()
  },
}
