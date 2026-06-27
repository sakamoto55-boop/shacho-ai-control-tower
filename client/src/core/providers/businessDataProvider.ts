// Stub for Google Sheets / freee / TKC（将来）
// 将来: 経営指標データソースを接続する

import type { ProviderDescriptor, UnifiedBusinessMetric } from './providerTypes'

export const businessDataProvider = {
  getDescriptor(): ProviderDescriptor {
    return {
      providerId: 'business-data',
      providerName: '経営データ（Sheets / freee / TKC）',
      providerType: 'business-data',
      sourceService: 'Google Sheets / freee / TKC',
      connectionStatus: 'planned',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: 'unknown',
      errors: [],
      warnings: [],
      nextPhase: 'Google Sheets / freee / TKC（将来）',
    }
  },

  async getItems(): Promise<UnifiedBusinessMetric[]> {
    return []
  },

  async refresh(): Promise<void> {
    // stub
  },
}
