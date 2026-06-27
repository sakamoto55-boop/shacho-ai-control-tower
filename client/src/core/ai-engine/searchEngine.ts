// 横断検索エンジン — inbox + schedule + file を横断して検索する

import type { UnifiedInboxItem, UnifiedFileItem } from '../providers/providerTypes'
import { searchDriveFiles } from '../../services/drive/driveSearch'

export interface SearchResults {
  inbox: UnifiedInboxItem[]
  files: UnifiedFileItem[]
  totalCount: number
}

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

  // Drive ファイル検索（Phase 7 追加）
  searchFiles(query: string, files: UnifiedFileItem[]): UnifiedFileItem[] {
    if (!query.trim()) return []
    return searchDriveFiles(query, files).map((r) => r.item)
  },

  // Inbox + Drive 横断検索
  searchAll(query: string, inbox: UnifiedInboxItem[], files: UnifiedFileItem[]): SearchResults {
    if (!query.trim()) return { inbox: [], files: [], totalCount: 0 }
    const inboxResults = this.search(query, inbox)
    const fileResults = this.searchFiles(query, files)
    return {
      inbox: inboxResults,
      files: fileResults,
      totalCount: inboxResults.length + fileResults.length,
    }
  },
}
