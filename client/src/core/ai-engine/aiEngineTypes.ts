import type {
  UnifiedInboxItem,
  UnifiedScheduleItem,
  UnifiedBusinessMetric,
  UnifiedRisk,
  UnifiedNotification,
} from '../providers/providerTypes'

// ─── データソース名 ───────────────────────────────────────────
export type DataSources =
  | 'gmail'
  | 'line-works'
  | 'google-calendar'
  | 'google-drive'
  | 'google-sheets'
  | 'freee'
  | 'tkc'
  | 'internal'

// ─── 分析コンテキスト（横断データセット） ────────────────────
export interface AnalysisContext {
  inbox: UnifiedInboxItem[]
  schedule: UnifiedScheduleItem[]
  businessMetrics: UnifiedBusinessMetric[]
  risks: UnifiedRisk[]
  notifications?: UnifiedNotification[]
  analyzedAt: string // ISO 8601
}

// ─── 優先度スコア ─────────────────────────────────────────────
export interface PriorityScore {
  itemId: string
  source: string
  baseScore: number // 0-100
  modifiers: {
    reason: string
    delta: number
  }[]
  finalScore: number
  rank: number
}

// ─── ブリーフィングセクション ─────────────────────────────────
export interface BriefingSection {
  sectionType: 'inbox' | 'schedule' | 'files' | 'business-data' | 'risk' | 'action' | 'notification'
  title: string
  items: string[]
  alertLevel: 'danger' | 'warning' | 'info' | null
}
