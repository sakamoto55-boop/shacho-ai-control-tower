// Schedule Provider — Google Calendar ReadOnly（Phase 6）
// 書き込みAPIは実装しない
//   createEvent   — 未実装
//   updateEvent   — 未実装
//   deleteEvent   — 未実装
//   respondEvent  — 未実装
//   attendeeModify — 未実装

import { googleToken } from '../../services/google/googleToken'
import { calendarClient } from '../../services/calendar/calendarClient'
import { mapGoogleCalendarEventToUnifiedScheduleItem } from '../../services/calendar/calendarMapper'
import type { ProviderDescriptor, UnifiedScheduleItem } from './providerTypes'

export const scheduleProvider = {
  getDescriptor(): ProviderDescriptor {
    const hasToken = googleToken.hasToken()
    return {
      providerId: 'google-calendar',
      providerName: 'Googleカレンダー',
      providerType: 'schedule',
      sourceService: 'Google Calendar',
      connectionStatus: hasToken ? 'connected' : 'disconnected',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: 'healthy',
      errors: [],
      warnings: hasToken ? [] : ['Google OAuth 未接続 — デモデータを使用中'],
      nextPhase: '予定データをAIブリーフィングへ反映（Phase 6完了済）',
    }
  },

  async getItems(): Promise<UnifiedScheduleItem[]> {
    const result = await calendarClient.fetchEvents()
    const sourceLabel = result.source === 'api' ? 'google-calendar' : 'demo'
    return result.events
      .filter((e) => e.status !== 'cancelled')
      .map((e) => mapGoogleCalendarEventToUnifiedScheduleItem(e, sourceLabel))
  },

  async refresh(): Promise<void> {
    await calendarClient.refreshEvents()
  },

  isUsingDemo(): boolean {
    return calendarClient.isUsingMock()
  },
}
