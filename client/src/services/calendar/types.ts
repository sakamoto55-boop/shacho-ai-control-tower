// Google Calendar API レスポンス型（ReadOnly）
// 書き込み系のフィールドは型定義にも含めない

export interface GoogleCalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>
  organizer?: { email: string; displayName?: string }
  status: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
  calendarId?: string
  calendarName?: string
  created?: string
  updated?: string
  recurrence?: string[]
}

export type CalendarEventCategory =
  | '銀行'
  | '面談'
  | '会議'
  | '現場'
  | '行政'
  | '福祉'
  | '締切'
  | '支払'
  | '請求'
  | '監査'
  | 'その他'

export type CalendarEventImportance = 'A' | 'B' | 'C'

// アプリ内変換後の型
export interface CalendarDerivedEvent {
  calendarEventId: string
  title: string
  description: string | null
  startAt: string // ISO 8601
  endAt: string | null
  isAllDay: boolean
  location: string | null
  attendeeCount: number
  attendeeNames: string[]
  calendarName: string
  importance: CalendarEventImportance
  category: CalendarEventCategory
  relatedCompany: string | null
  relatedPerson: string | null
  deadlineRisk: boolean
  suggestedAction: string | null
  sourceLabel: 'demo' | 'google-calendar'
}

export interface CalendarSummary {
  totalCount: number
  importanceACount: number
  deadlineRiskCount: number
  travelRequiredCount: number
  bankCount: number
  adminCount: number
  meetingCount: number
  topItems: GoogleCalendarEvent[]
}
