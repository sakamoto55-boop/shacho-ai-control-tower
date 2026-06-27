// Stub for Google Calendar (Phase 6)
// 将来: Google Calendar ReadOnly を接続する

import type { ProviderDescriptor, UnifiedScheduleItem } from './providerTypes'

export const scheduleProvider = {
  getDescriptor(): ProviderDescriptor {
    return {
      providerId: 'google-calendar',
      providerName: 'Googleカレンダー',
      providerType: 'schedule',
      sourceService: 'Google Calendar',
      connectionStatus: 'planned',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: 'unknown',
      errors: [],
      warnings: [],
      nextPhase: 'Google Calendar ReadOnly（Phase 6）',
    }
  },

  async getItems(): Promise<UnifiedScheduleItem[]> {
    return []
  },

  async refresh(): Promise<void> {
    // stub
  },
}
