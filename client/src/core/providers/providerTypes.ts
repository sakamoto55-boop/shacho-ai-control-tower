// ─── Provider接続・健全性ステータス ───────────────────────────
// NOTE: ConnectionStatus / HealthStatus は types/index.ts に定義済みのため
// Provider 専用の名前を使用する（名前衝突回避）

export type ProviderConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'error'
  | 'planned'

export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'unknown'

export type ProviderType =
  | 'inbox'
  | 'schedule'
  | 'file'
  | 'business-data'
  | 'workflow'
  | 'notification'

// ─── Provider記述子 ──────────────────────────────────────────
export interface ProviderDescriptor {
  providerId: string
  providerName: string
  providerType: ProviderType
  sourceService: string
  connectionStatus: ProviderConnectionStatus
  readOnly: boolean
  writeEnabled: boolean
  lastSyncAt: string | null
  healthStatus: ProviderHealthStatus
  errors: string[]
  warnings: string[]
  nextPhase: string | null
}

// ─── 統合受信トレイアイテム（Gmail / LINE WORKS） ────────────
export interface UnifiedInboxItem {
  id: string
  source: string
  providerType: 'inbox'
  from: string
  fromName: string
  subject: string
  bodyPreview: string
  receivedAt: string // ISO 8601
  isRead: boolean
  hasAttachment: boolean
  labels: string[]
  priority: 'A' | 'B' | 'C'
  taskType: string
  deadline: string | null
  replyDraftAvailable: boolean
  writeProtected: true
  requiresApproval: true
}

// ─── 統合スケジュールアイテム（Calendar） ────────────────────
export interface UnifiedScheduleItem {
  id: string
  source: string              // 'デモCalendar' | 'Google Calendar'
  providerType: 'schedule'
  title: string
  description: string | null
  startAt: string             // ISO 8601
  endAt: string | null
  location: string | null
  isAllDay: boolean
  attendees: string[]
  calendarName: string
  priority: 'A' | 'B' | 'C'
  alertLevel: 'danger' | 'warning' | 'info' | null
  category: string            // '銀行' | '面談' | '会議' | '現場' | '行政' | '福祉' | '締切' | '支払' | '請求' | '監査' | 'その他'
  relatedCompany: string | null
  relatedPerson: string | null
  deadlineRisk: boolean
  suggestedAction: string | null
  readOnly: true
  writeEnabled: false
}

// ─── 統合ファイルアイテム（Drive） ───────────────────────────
export interface UnifiedFileItem {
  id: string
  source: string
  providerType: 'file'
  name: string
  mimeType: string
  fileType: string
  webViewLink: string | null
  createdAt: string   // ISO 8601
  modifiedAt: string  // ISO 8601
  ownerName: string | null
  /** @deprecated use ownerName */
  owner: string | null
  folderName: string | null
  category: string
  relatedCompany: string | null
  relatedPerson: string | null
  relatedProject: string | null
  importance: 'A' | 'B' | 'C'
  alertLevel: 'danger' | 'warning' | 'info' | null
  riskFlag: boolean
  suggestedAction: string | null
  readOnly: true
  writeEnabled: false
}

// ─── 統合経営指標（Sheets / freee / TKC） ────────────────────
export interface UnifiedBusinessMetric {
  id: string
  source: string
  providerType: 'business-data'
  metricKey: string
  metricName: string
  category: '売上' | '粗利' | '資金繰り' | '請求' | '未回収' | '外注費' | '事故' | '稼働率' | 'その他'
  value: number
  unit: string
  period: string
  previousValue: number | null
  changeAmount: number | null
  changeRate: number | null
  status: 'normal' | 'warning' | 'danger'
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | null
  relatedCompany: string | null
  relatedDepartment: string | null
  relatedProject: string | null
  suggestedAction: string | null
  dataSourceName: string
  lastUpdatedAt: string
  alertLevel: 'danger' | 'warning' | 'info' | null
  alertReason: string | null
  label: string
  trend: 'up' | 'down' | 'neutral' | null
  readOnly: true
  writeEnabled: false
}

// ─── 13週資金繰り週次データ ──────────────────────────────────
export interface UnifiedCashflowWeek {
  week: string
  income: number
  expense: number
  balance: number
  alert: boolean
  alertLevel: 'danger' | 'warning' | null
}

// ─── 案件別粗利 ──────────────────────────────────────────────
export interface UnifiedProjectProfit {
  id: string
  projectName: string
  revenue: number
  grossProfit: number
  grossProfitRate: number
  relatedCompany: string | null
  relatedDepartment: string | null
  alert: boolean
}

// ─── 部門別指標 ──────────────────────────────────────────────
export interface UnifiedDepartmentMetric {
  id: string
  departmentName: string
  revenue: number
  profit: number
  profitRate: number
  headcount: number | null
}

// ─── 統合経営データセット ────────────────────────────────────
export interface UnifiedBusinessDataset {
  metrics: UnifiedBusinessMetric[]
  cashflowWeeks: UnifiedCashflowWeek[]
  projectProfits: UnifiedProjectProfit[]
  departmentMetrics: UnifiedDepartmentMetric[]
  source: 'mock' | 'cache' | 'api'
  fetchedAt: string
}

// ─── 統合ワークフローアイテム（承認・下書き） ─────────────────
export interface UnifiedWorkflowItem {
  id: string
  source: string
  providerType: 'workflow'
  type: 'approval' | 'draft' | 'delegation' | 'review'
  title: string
  body: string | null
  requestedAt: string // ISO 8601
  status: 'pending' | 'approved' | 'rejected' | 'draft'
  requiresApproval: true
  approvedAt: string | null
}

// ─── 統合通知（アラート・ブリーフィング） ────────────────────
export interface UnifiedNotification {
  id: string
  source: string
  providerType: 'notification'
  type: 'alert' | 'info' | 'warning' | 'morning-briefing'
  title: string
  body: string
  receivedAt: string // ISO 8601
  priority: 'A' | 'B' | 'C'
  isRead: boolean
  actionRequired: boolean
}

// ─── 統合リスク（横断サービスリスク） ───────────────────────
export interface UnifiedRisk {
  id: string
  sources: string[]
  riskType: '資金繰り' | '未回収' | '未請求' | '人員不足' | '事故' | '契約期限' | 'その他'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  detectedAt: string // ISO 8601
  deadline: string | null
}

// ─── 統合アクション提案（外部実行なし・提案のみ） ───────────
export interface UnifiedActionSuggestion {
  id: string
  triggerSources: string[]
  actionType:
    | 'reply-draft'
    | 'approval-request'
    | 'schedule'
    | 'delegate'
    | 'document'
    | 'alert'
    | 'review'
  title: string
  description: string
  priority: 'A' | 'B' | 'C'
  estimatedImpact: string
  requiresApproval: true
  writeEnabled: false
  suggestedAt: string // ISO 8601
}

// ─── 統合承認リクエスト（外部アクション実行前の承認） ─────────
export interface UnifiedApprovalRequest {
  id: string
  requestType: 'send-email' | 'send-document' | 'external-action' | 'delegation'
  title: string
  description: string
  targetService: string
  requestedAt: string // ISO 8601
  status: 'pending' | 'approved' | 'rejected'
  executeAfterApproval: true
}
