// カレンダーイベント分析（重要度・カテゴリ・リスク判定）
// 書き込み処理は一切含まない

import type { GoogleCalendarEvent, CalendarEventCategory, CalendarEventImportance, CalendarSummary } from './types'

const CATEGORY_KEYWORDS: Record<CalendarEventCategory, string[]> = {
  '銀行':   ['銀行', '信金', '信用', '融資', '口座', 'ファイナンス', '金融'],
  '面談':   ['面談', '商談', 'ミーティング', '打合せ', '打ち合わせ', '相談'],
  '会議':   ['会議', '会合', '運営', '定例'],
  '現場':   ['現場', '施設', '工事', '確認', '点検', '巡回'],
  '行政':   ['区役所', '市役所', '都庁', '行政', '補助金', '申請', '許認可', '監督署', '労基'],
  '福祉':   ['介護', '福祉', '利用者', '訪問', 'デイ', 'ケア'],
  '締切':   ['締切', '締め切り', '期限', '提出', '最終'],
  '支払':   ['支払', '振込', '決済', '精算'],
  '請求':   ['請求', '請求書', 'インボイス', '外注費'],
  '監査':   ['監査', '税務', '会計', '決算', 'TKC', 'freee'],
  'その他': [],
}

const IMPORTANCE_KEYWORDS: Record<'A' | 'B', string[]> = {
  A: ['銀行', '融資', '監査', '行政', '補助金', '締切', '期限', '至急', '緊急', '最終'],
  B: ['面談', '会議', '現場', '請求', '支払', '外注費'],
}

export function analyzeCategory(event: GoogleCalendarEvent): CalendarEventCategory {
  const text = `${event.summary ?? ''} ${event.description ?? ''} ${event.location ?? ''}`
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [CalendarEventCategory, string[]][]) {
    if (cat === 'その他') continue
    if (keywords.some((k) => text.includes(k))) return cat
  }
  return 'その他'
}

export function analyzeImportance(event: GoogleCalendarEvent): CalendarEventImportance {
  const text = `${event.summary ?? ''} ${event.description ?? ''}`
  if (IMPORTANCE_KEYWORDS.A.some((k) => text.includes(k))) return 'A'
  if (IMPORTANCE_KEYWORDS.B.some((k) => text.includes(k))) return 'B'
  return 'C'
}

export function extractRelatedCompany(event: GoogleCalendarEvent): string | null {
  const text = `${event.summary ?? ''} ${event.description ?? ''}`
  const matches = text.match(/[A-Z一-龯ぁ-ん]*(銀行|信金|信用金庫|株式会社|合同会社|区役所|市役所|監督署)/)
  return matches ? matches[0] : null
}

export function extractRelatedPerson(event: GoogleCalendarEvent): string | null {
  const attendees = event.attendees ?? []
  const first = attendees.find((a) => a.displayName)
  return first?.displayName ?? null
}

export function hasDeadlineRisk(event: GoogleCalendarEvent): boolean {
  const text = `${event.summary ?? ''} ${event.description ?? ''}`
  return ['締切', '期限', '提出', '最終', '本日中', '今日中', '支払', '振込'].some((k) =>
    text.includes(k)
  )
}

export function suggestAction(event: GoogleCalendarEvent, category: CalendarEventCategory): string | null {
  switch (category) {
    case '銀行':
      return '関連資料を事前に確認してください（財務諸表・事業計画書）'
    case '現場':
      return '現場報告書を準備し、確認後は本日中に提出してください'
    case '行政':
      return '必要書類の揃いを確認し、期限前に提出してください'
    case '締切':
      return '本日中に対応が必要です。関連メールを確認してください'
    case '請求':
      return '請求金額を確認し、承認または問合せを完了させてください'
    case '監査':
      return '会計データの最終確認を行い、不明点は事前に整理してください'
    default:
      return event.description ? '事前に詳細を確認してください' : null
  }
}

export function requiresTravelTime(event: GoogleCalendarEvent): boolean {
  return !!(event.location && !event.location.includes('会議室') && !event.location.includes('オンライン') && !event.location.includes('Zoom') && !event.location.includes('Teams'))
}

export function createCalendarSummary(events: GoogleCalendarEvent[]): CalendarSummary {
  const confirmed = events.filter((e) => e.status !== 'cancelled')
  const topItems = confirmed.slice(0, 3)

  return {
    totalCount: confirmed.length,
    importanceACount: confirmed.filter((e) => analyzeImportance(e) === 'A').length,
    deadlineRiskCount: confirmed.filter((e) => hasDeadlineRisk(e)).length,
    travelRequiredCount: confirmed.filter((e) => requiresTravelTime(e)).length,
    bankCount: confirmed.filter((e) => analyzeCategory(e) === '銀行').length,
    adminCount: confirmed.filter((e) => analyzeCategory(e) === '行政').length,
    meetingCount: confirmed.filter((e) => ['面談', '会議'].includes(analyzeCategory(e))).length,
    topItems,
  }
}
