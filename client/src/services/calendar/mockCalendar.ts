// デモ用カレンダーイベント（本番Calendar未接続時に使用）
// 一般社団法人みらい創造公社 想定の業務予定

import type { GoogleCalendarEvent } from './types'

const TODAY = new Date()
const dateStr = (h: number, m = 0) => {
  const d = new Date(TODAY)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

export const mockCalendarEvents: GoogleCalendarEvent[] = [
  {
    id: 'cal-001',
    summary: '東京信用金庫 追加資料提出打合せ',
    description: '融資審査用の追加資料について確認。財務諸表・事業計画書を持参。',
    location: '東京信用金庫 本店 3F 応接室',
    start: { dateTime: dateStr(10, 0) },
    end: { dateTime: dateStr(11, 30) },
    attendees: [
      { email: 'yamamoto@bank.co.jp', displayName: '山本支店長', responseStatus: 'accepted' },
    ],
    organizer: { email: 'shacho@mirai.org', displayName: '代表取締役' },
    status: 'confirmed',
    calendarName: 'みらい創造公社',
  },
  {
    id: 'cal-002',
    summary: '現場確認 — 介護施設C棟 改修工事',
    description: '外注業者・現場責任者と安全確認。報告書提出期限：本日中。',
    location: '〒xxx-xxxx 東京都〇〇区 介護施設C棟',
    start: { dateTime: dateStr(13, 30) },
    end: { dateTime: dateStr(15, 0) },
    attendees: [
      { email: 'kato@mirai.org', displayName: '加藤現場責任者', responseStatus: 'accepted' },
      { email: 'contractor@example.com', displayName: '外注業者担当', responseStatus: 'accepted' },
    ],
    organizer: { email: 'shacho@mirai.org', displayName: '代表取締役' },
    status: 'confirmed',
    calendarName: 'みらい創造公社',
  },
  {
    id: 'cal-003',
    summary: 'お結び運営確認ミーティング',
    description: '月次運営状況・スタッフ確認・利用者対応状況を共有。',
    location: 'みらい創造公社 会議室',
    start: { dateTime: dateStr(16, 0) },
    end: { dateTime: dateStr(17, 0) },
    attendees: [
      { email: 'manager@mirai.org', displayName: '事業部長', responseStatus: 'accepted' },
    ],
    organizer: { email: 'shacho@mirai.org', displayName: '代表取締役' },
    status: 'confirmed',
    calendarName: 'みらい創造公社',
  },
  {
    id: 'cal-004',
    summary: '区役所 補助金申請 書類締切',
    description: '地域福祉活動補助金の申請書類提出期限。窓口 or 郵送。',
    location: '〇〇区役所 福祉課',
    start: { date: TODAY.toISOString().split('T')[0] },
    end: { date: TODAY.toISOString().split('T')[0] },
    status: 'confirmed',
    calendarName: 'みらい創造公社 行政',
  },
  {
    id: 'cal-005',
    summary: '月次外注費 請求確認期限',
    description: '今月分の外注費請求書確認・承認。支払期日: 今月末。',
    start: { date: TODAY.toISOString().split('T')[0] },
    end: { date: TODAY.toISOString().split('T')[0] },
    status: 'confirmed',
    calendarName: 'みらい創造公社 財務',
  },
]
