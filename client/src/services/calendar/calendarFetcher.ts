// Google Calendar API 読み取り専用フェッチャー
// GET のみ使用。予定作成・更新・削除・招待返信は実装しない。
//
// 未実装（書き込み禁止）:
//   createEvent   — 未実装
//   updateEvent   — 未実装
//   deleteEvent   — 未実装
//   respondEvent  — 未実装
//   attendeeModify — 未実装

import type { GoogleCalendarEvent } from './types'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

export async function fetchCalendarEvents(accessToken: string): Promise<GoogleCalendarEvent[]> {
  // 今日の始まりから1週間分を取得
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(todayStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const params = new URLSearchParams({
    calendarId: 'primary',
    timeMin: todayStart.toISOString(),
    timeMax: weekEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })

  const res = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Calendar API error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json() as { items?: GoogleCalendarEvent[] }
  return (data.items ?? []).map((item) => ({
    ...item,
    calendarName: 'Googleカレンダー',
  }))
}
