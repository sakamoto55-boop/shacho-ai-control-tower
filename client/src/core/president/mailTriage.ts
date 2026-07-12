// 要対応メールのトリアージ（読み取り専用・表示用）。
// - 返信が必要と推定されるメールを優先
// - 自動送信/広告/メルマガ/通知メールは優先度を下げる
// - 重複を除外
// 本文全文は扱わない（件名・送信者・要約のみ）。

import type { UnifiedInboxItem } from '../providers/providerTypes'

export interface TriagedMail {
  item: UnifiedInboxItem
  score: number
  replyNeeded: boolean
  deprioritized: boolean
}

// メルマガ/自動送信/通知を示すパターン（差出人・件名から推定）
const NOREPLY_RE = /no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|postmaster/i
const BULK_RE = /配信停止|配信解除|メルマガ|メールマガジン|newsletter|unsubscribe|自動送信|自動配信|通知メール|ニュースレター|お知らせ配信/i

// Gmailのカテゴリラベル（広告・SNS・フォーラム・更新は優先度を下げる）
const LOW_PRIORITY_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES']

function isDeprioritized(i: UnifiedInboxItem): boolean {
  const senderText = `${i.from} ${i.fromName}`
  if (NOREPLY_RE.test(senderText)) return true
  if (BULK_RE.test(`${i.subject} ${i.bodyPreview} ${senderText}`)) return true
  if (i.labels?.some((l) => LOW_PRIORITY_LABELS.includes(l))) return true
  return false
}

function scoreOf(i: UnifiedInboxItem, deprioritized: boolean): number {
  let s = 0
  if (i.priority === 'A') s += 30
  else if (i.priority === 'B') s += 10
  else s -= 10
  if (!i.isRead) s += 10
  if (i.replyDraftAvailable) s += 10
  if (i.deadline) s += 10
  if (deprioritized) s -= 50
  return s
}

// 返信が必要と推定されるか（自動送信類は除外）
function replyNeededOf(i: UnifiedInboxItem, deprioritized: boolean): boolean {
  if (deprioritized) return false
  const important = i.priority === 'A' || i.priority === 'B'
  return important && (!i.isRead || i.replyDraftAvailable)
}

// 要対応メールを算出（Gmail由来のみ・重複除外・スコア順）
export function triageActionMail(items: UnifiedInboxItem[], limit = 8): TriagedMail[] {
  const gmail = items.filter((i) => i.source === 'gmail')

  const triaged: TriagedMail[] = gmail.map((item) => {
    const deprioritized = isDeprioritized(item)
    return { item, deprioritized, score: scoreOf(item, deprioritized), replyNeeded: replyNeededOf(item, deprioritized) }
  })

  // 重複除外（件名＋送信者が同一なら最高スコアを残す）
  const byKey = new Map<string, TriagedMail>()
  for (const t of triaged) {
    const key = `${t.item.subject}||${t.item.fromName}`
    const existing = byKey.get(key)
    if (!existing || t.score > existing.score) byKey.set(key, t)
  }

  return Array.from(byKey.values())
    .sort((a, b) => {
      // 返信必要を優先 → スコア降順
      if (a.replyNeeded !== b.replyNeeded) return a.replyNeeded ? -1 : 1
      return b.score - a.score
    })
    .slice(0, limit)
}
