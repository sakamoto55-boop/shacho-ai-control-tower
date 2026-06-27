// 横断検索エンジン — inbox + schedule + file + metrics を横断して検索する

import type { UnifiedInboxItem, UnifiedFileItem, UnifiedBusinessMetric } from '../providers/providerTypes'
import { searchDriveFiles } from '../../services/drive/driveSearch'

export interface SearchResults {
  inbox: UnifiedInboxItem[]
  files: UnifiedFileItem[]
  metrics: UnifiedBusinessMetric[]
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

  // BusinessData 経営指標検索（Phase 8 追加）
  searchMetrics(query: string, metrics: UnifiedBusinessMetric[]): UnifiedBusinessMetric[] {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return metrics.filter(
      (m) =>
        m.metricName.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.relatedCompany?.toLowerCase().includes(q) ?? false) ||
        (m.relatedDepartment?.toLowerCase().includes(q) ?? false) ||
        (m.relatedProject?.toLowerCase().includes(q) ?? false) ||
        (m.alertReason?.toLowerCase().includes(q) ?? false)
    )
  },

  // Inbox + Drive + BusinessData 横断検索
  searchAll(
    query: string,
    inbox: UnifiedInboxItem[],
    files: UnifiedFileItem[],
    metrics: UnifiedBusinessMetric[] = []
  ): SearchResults {
    if (!query.trim()) return { inbox: [], files: [], metrics: [], totalCount: 0 }
    const inboxResults = this.search(query, inbox)
    const fileResults = this.searchFiles(query, files)
    const metricResults = this.searchMetrics(query, metrics)
    return {
      inbox: inboxResults,
      files: fileResults,
      metrics: metricResults,
      totalCount: inboxResults.length + fileResults.length + metricResults.length,
    }
  },
}
