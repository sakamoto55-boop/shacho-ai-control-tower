// カレンダーイベントのローカルキャッシュ（5分 TTL）
// Gmailキャッシュと同一設計

import type { GoogleCalendarEvent } from './types'

const CACHE_KEY = 'calendar_event_cache'
const CACHE_AT_KEY = 'calendar_cache_at'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5分

export const calendarCache = {
  get(): GoogleCalendarEvent[] | null {
    try {
      const cachedAt = localStorage.getItem(CACHE_AT_KEY)
      if (!cachedAt) return null
      const elapsed = Date.now() - Number(cachedAt)
      if (elapsed > CACHE_TTL_MS) return null
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      return JSON.parse(raw) as GoogleCalendarEvent[]
    } catch {
      return null
    }
  },

  set(events: GoogleCalendarEvent[]): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(events))
      localStorage.setItem(CACHE_AT_KEY, String(Date.now()))
    } catch {
      // localStorage 容量超過時は無視
    }
  },

  clear(): void {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(CACHE_AT_KEY)
  },

  isStale(): boolean {
    const cachedAt = localStorage.getItem(CACHE_AT_KEY)
    if (!cachedAt) return true
    return Date.now() - Number(cachedAt) > CACHE_TTL_MS
  },

  getLastFetchedAt(): Date | null {
    const cachedAt = localStorage.getItem(CACHE_AT_KEY)
    return cachedAt ? new Date(Number(cachedAt)) : null
  },
}
