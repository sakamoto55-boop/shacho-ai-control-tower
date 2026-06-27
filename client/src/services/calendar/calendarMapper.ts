// Google Calendar イベント → UnifiedScheduleItem 変換
// 書き込みフィールドは生成しない

import type { GoogleCalendarEvent, CalendarDerivedEvent } from './types'
import type { UnifiedScheduleItem } from '../../core/providers/providerTypes'
import {
  analyzeCategory,
  analyzeImportance,
  extractRelatedCompany,
  extractRelatedPerson,
  hasDeadlineRisk,
  suggestAction,
} from './calendarAnalyzer'

export function mapToCalendarDerivedEvent(event: GoogleCalendarEvent, sourceLabel: 'demo' | 'google-calendar' = 'demo'): CalendarDerivedEvent {
  const isAllDay = !event.start.dateTime
  const startAt = event.start.dateTime ?? event.start.date ?? new Date().toISOString()
  const endAt = event.end?.dateTime ?? event.end?.date ?? null
  const category = analyzeCategory(event)
  const importance = analyzeImportance(event)

  return {
    calendarEventId: event.id,
    title: event.summary ?? '（タイトルなし）',
    description: event.description ?? null,
    startAt,
    endAt,
    isAllDay,
    location: event.location ?? null,
    attendeeCount: event.attendees?.length ?? 0,
    attendeeNames: (event.attendees ?? []).map((a) => a.displayName ?? a.email),
    calendarName: event.calendarName ?? 'Googleカレンダー',
    importance,
    category,
    relatedCompany: extractRelatedCompany(event),
    relatedPerson: extractRelatedPerson(event),
    deadlineRisk: hasDeadlineRisk(event),
    suggestedAction: suggestAction(event, category),
    sourceLabel,
  }
}

export function mapCalendarDerivedEventToUnifiedScheduleItem(ev: CalendarDerivedEvent): UnifiedScheduleItem {
  return {
    id: `calendar-${ev.calendarEventId}`,
    source: ev.sourceLabel === 'demo' ? 'デモCalendar' : 'Google Calendar',
    providerType: 'schedule',
    title: ev.title,
    description: ev.description,
    startAt: ev.startAt,
    endAt: ev.endAt,
    location: ev.location,
    isAllDay: ev.isAllDay,
    attendees: ev.attendeeNames,
    calendarName: ev.calendarName,
    priority: ev.importance,
    alertLevel: ev.deadlineRisk ? 'danger' : ev.importance === 'A' ? 'warning' : null,
    category: ev.category,
    relatedCompany: ev.relatedCompany,
    relatedPerson: ev.relatedPerson,
    deadlineRisk: ev.deadlineRisk,
    suggestedAction: ev.suggestedAction,
    readOnly: true as const,
    writeEnabled: false as const,
  }
}

export function mapGoogleCalendarEventToUnifiedScheduleItem(
  event: GoogleCalendarEvent,
  sourceLabel: 'demo' | 'google-calendar' = 'demo'
): UnifiedScheduleItem {
  return mapCalendarDerivedEventToUnifiedScheduleItem(mapToCalendarDerivedEvent(event, sourceLabel))
}
