// 期限超過タスクの判定（読み取り専用・表示用）。
// 規則:
//  - 期限日がJSTで当日より前
//  - 完了状態ではない（既読かつ下書きなし＝対応済みとみなし除外）
//  - 同一タスクは重複除外（id + 件名/差出人）
//  - 期限が存在しないデータは超過扱いにしない
//  - 期限判定は日本時間 Asia/Tokyo
//  - 超過日数を返す

import type { UnifiedInboxItem } from '../providers/providerTypes'
import { overdueDaysJst } from './dateUtil'

export interface OverdueTask {
  item: UnifiedInboxItem
  days: number
}

// 対応済みとみなす（既読 & 返信下書きが残っていない）
function isHandled(i: UnifiedInboxItem): boolean {
  return i.isRead && !i.replyDraftAvailable
}

export function computeOverdue(items: UnifiedInboxItem[], now: number = Date.now(), limit = 8): OverdueTask[] {
  const seen = new Set<string>()
  const result: OverdueTask[] = []

  for (const item of items) {
    if (isHandled(item)) continue // 完了扱いは除外
    const days = overdueDaysJst(item.deadline, now)
    if (days === null) continue // 期限なし or 未来 は超過ではない

    const key = `${item.id}||${item.subject}||${item.fromName}`
    if (seen.has(key)) continue // 重複除外
    seen.add(key)

    result.push({ item, days })
  }

  return result.sort((a, b) => b.days - a.days).slice(0, limit)
}
