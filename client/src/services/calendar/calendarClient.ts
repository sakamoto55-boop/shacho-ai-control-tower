// Google Calendar クライアント（ReadOnly）
// 認証済みなら本番 Calendar API、未認証なら mockCalendar を返す
//
// 書き込みAPI は実装しない:
//   createEvent   — 未実装
//   updateEvent   — 未実装
//   deleteEvent   — 未実装
//   respondEvent  — 未実装
//   attendeeModify — 未実装

import { googleToken } from '../google/googleToken'
import { calendarCache } from './calendarCache'
import { fetchCalendarEvents } from './calendarFetcher'
import { mockCalendarEvents } from './mockCalendar'
import type { GoogleCalendarEvent } from './types'

export type CalendarDataSource = 'mock' | 'cache' | 'api'

interface FetchResult {
  events: GoogleCalendarEvent[]
  source: CalendarDataSource
}

export const calendarClient = {
  async fetchEvents(): Promise<FetchResult> {
    if (!googleToken.hasToken()) {
      return { events: mockCalendarEvents, source: 'mock' }
    }

    const cached = calendarCache.get()
    if (cached) {
      return { events: cached, source: 'cache' }
    }

    try {
      const accessToken = googleToken.getOrThrow()
      const events = await fetchCalendarEvents(accessToken)
      calendarCache.set(events)
      return { events, source: 'api' }
    } catch {
      const stale = localStorage.getItem('calendar_event_cache')
      if (stale) {
        return { events: JSON.parse(stale) as GoogleCalendarEvent[], source: 'cache' }
      }
      return { events: mockCalendarEvents, source: 'mock' }
    }
  },

  async refreshEvents(): Promise<FetchResult> {
    calendarCache.clear()
    return this.fetchEvents()
  },

  isUsingMock(): boolean {
    return !googleToken.hasToken()
  },
}
