import type {
  UnifiedInboxItem,
  UnifiedScheduleItem,
  UnifiedBusinessMetric,
  UnifiedFileItem,
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

// ─── Phase 10: AI Engine 統合型 ──────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'deferred'

export interface EvidenceSource {
  type: 'inbox' | 'schedule' | 'file' | 'metric' | 'notification'
  id: string
  title: string
  snippet: string
  source: string
}

export interface CrossProviderContext {
  id: string
  theme: string
  title: string
  summary: string
  importance: 'A' | 'B' | 'C'
  urgency: 'critical' | 'high' | 'medium' | 'low'
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none'
  reason: string
  evidenceSources: EvidenceSource[]
  suggestedAction: string
  requiresApproval: boolean
  approvalStatus: ApprovalStatus
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface DecisionItem {
  id: string
  rank: number
  title: string
  summary: string
  importance: 'A' | 'B' | 'C'
  urgency: 'critical' | 'high' | 'medium' | 'low'
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none'
  reason: string
  evidenceSources: EvidenceSource[]
  suggestedAction: string
  timeEstimate: string
  requiresApproval: boolean
  approvalStatus: ApprovalStatus
  category: 'bank' | 'billing' | 'accident' | 'personnel' | 'contract' | 'field' | 'other'
  isImmediate: boolean
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface ActionDraft {
  id: string
  title: string
  actionType: 'reply' | 'delegate' | 'confirm' | 'report' | 'remind'
  targetName: string
  targetContext: string
  draftText: string
  reason: string
  evidenceSources: EvidenceSource[]
  requiresApproval: true
  approvalStatus: ApprovalStatus
  readonly externalSendDisabled: true
  readonly saveDisabled: true
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface HealthCategory {
  score: number
  status: 'good' | 'warning' | 'danger'
  comment: string
}

export interface CompanyHealthScore {
  total: number
  grade: 'A' | 'B' | 'C' | 'D'
  breakdown: {
    cashflow: HealthCategory
    grossProfit: HealthCategory
    unbilled: HealthCategory
    uncollected: HealthCategory
    accident: HealthCategory
    personnel: HealthCategory
    sales: HealthCategory
    internalSOS: HealthCategory
    scheduleLoad: HealthCategory
  }
  topRisks: string[]
  generatedAt: string
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface ExecutiveBriefing {
  id: string
  generatedAt: string
  greeting: string
  headline: string
  headlineReason: string
  summaryText: string
  todayFocusItems: string[]
  crossContexts: CrossProviderContext[]
  topDecisions: DecisionItem[]
  healthScore: CompanyHealthScore
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface TodayPriorityPlan {
  id: string
  generatedAt: string
  immediateActions: DecisionItem[]
  decisions: DecisionItem[]
  approvalQueue: ActionDraft[]
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface RiskCluster {
  id: string
  theme: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  risks: UnifiedRisk[]
  crossContextId?: string
  readonly readOnly: true
  readonly writeEnabled: false
}

export interface OrchestratorResult {
  briefing: ExecutiveBriefing
  todayPlan: TodayPriorityPlan
  healthScore: CompanyHealthScore
  risks: UnifiedRisk[]
  riskClusters: RiskCluster[]
  approvalQueue: ActionDraft[]
  crossContexts: CrossProviderContext[]
  generatedAt: string
}

// Re-export provider types used by AI engines
export type { UnifiedInboxItem, UnifiedScheduleItem, UnifiedBusinessMetric, UnifiedFileItem, UnifiedRisk, UnifiedNotification }
