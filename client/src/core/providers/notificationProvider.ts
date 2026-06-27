// Stub for 朝ブリーフィング・アラート自動配信（将来）
// 将来: 通知・ブリーフィング配信エンジンを接続する

import type { ProviderDescriptor, UnifiedNotification } from './providerTypes'

export const notificationProvider = {
  getDescriptor(): ProviderDescriptor {
    return {
      providerId: 'notification-briefing',
      providerName: '朝ブリーフィング・アラート',
      providerType: 'notification',
      sourceService: '内部AI通知エンジン',
      connectionStatus: 'planned',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: 'unknown',
      errors: [],
      warnings: [],
      nextPhase: '朝ブリーフィング自動配信（将来）',
    }
  },

  async getItems(): Promise<UnifiedNotification[]> {
    return []
  },

  async refresh(): Promise<void> {
    // stub
  },
}
