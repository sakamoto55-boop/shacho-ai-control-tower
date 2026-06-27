// Stub for Google Drive（将来）
// 将来: Google Drive ReadOnly を接続する

import type { ProviderDescriptor, UnifiedFileItem } from './providerTypes'

export const fileProvider = {
  getDescriptor(): ProviderDescriptor {
    return {
      providerId: 'google-drive',
      providerName: 'Google Drive',
      providerType: 'file',
      sourceService: 'Google Drive',
      connectionStatus: 'planned',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: 'unknown',
      errors: [],
      warnings: [],
      nextPhase: 'Google Drive ReadOnly（将来）',
    }
  },

  async getItems(): Promise<UnifiedFileItem[]> {
    return []
  },

  async refresh(): Promise<void> {
    // stub
  },
}
