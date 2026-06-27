// 横断検索エンジン
// 将来: inbox + schedule + file + businessData を横断して検索する

import type { UnifiedInboxItem } from '../providers/providerTypes'

export const searchEngine = {
  search(query: string, inbox: UnifiedInboxItem[]): UnifiedInboxItem[] {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return inbox.filter(
      (item) =>
        item.subject.toLowerCase().includes(q) ||
        item.from.toLowerCase().includes(q) ||
        item.bodyPreview.toLowerCase().includes(q) ||
        item.taskType.toLowerCase().includes(q)
    )
  },

  // 将来: searchSchedule(), searchFiles(), searchBusinessData()
}
