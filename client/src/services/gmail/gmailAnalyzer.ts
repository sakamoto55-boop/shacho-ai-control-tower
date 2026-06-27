import type { GmailMessage, GmailPriority, GmailTaskType } from './types'

const BANK_KEYWORDS = ['銀行', '融資', '金融', '審査', '借入', '利率', '返済']
const BILLING_KEYWORDS = ['請求', '支払', '未払', '振込', '入金', '代金', '未収']
const CONTRACT_KEYWORDS = ['契約', '署名', '捺印', '合意', '締結']
const ACCIDENT_KEYWORDS = ['事故', 'クレーム', '苦情', '怪我', '損害', '賠償']
const URGENT_KEYWORDS = ['至急', '本日中', '今日中', '緊急', '急いで', '即日']
const IMPORTANT_KEYWORDS = ['確認お願い', '対応', '期限', '承認']

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

export function analyzeTaskType(msg: GmailMessage): GmailTaskType {
  const text = msg.subject + ' ' + msg.body + ' ' + msg.from
  if (containsAny(text, BANK_KEYWORDS)) return '銀行'
  if (containsAny(text, BILLING_KEYWORDS)) return '請求'
  if (containsAny(text, CONTRACT_KEYWORDS)) return '契約'
  if (containsAny(text, ACCIDENT_KEYWORDS)) return '事故'
  return 'その他'
}

export function analyzePriority(msg: GmailMessage): GmailPriority {
  const text = msg.subject + ' ' + msg.body
  if (containsAny(text, URGENT_KEYWORDS)) return 'A'
  if (containsAny(text, IMPORTANT_KEYWORDS)) return 'B'
  if (msg.labels.includes('IMPORTANT')) return 'B'
  return 'C'
}

export function extractDeadline(msg: GmailMessage): string | null {
  const text = msg.subject + ' ' + msg.body
  if (text.includes('本日中') || text.includes('今日中')) return '本日中'
  if (text.includes('今週中')) return '今週中'
  const match = text.match(/(\d+月\d+日)/)
  if (match) return match[1] + 'まで'
  return null
}
