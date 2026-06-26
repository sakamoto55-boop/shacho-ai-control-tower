// ─── Screen / Navigation ─────────────────────────────────
export type Screen = 'home' | 'chat' | 'actions' | 'create' | 'dashboard' | 'settings'

// ─── Task / Priority ─────────────────────────────────────
export type Priority = 'A' | 'B' | 'waiting-confirm' | 'waiting-create'
export type TaskType =
  | 'メール'
  | 'LINE WORKS'
  | '承認'
  | '契約'
  | '請求'
  | '現場'
  | '事故'
  | '銀行'
  | '福祉'
export type Importance = 'high' | 'medium' | 'low'
export type TaskStatus = '未対応' | '対応中' | '確認中' | '完了'

// ─── AI Chat ─────────────────────────────────────────────
export type AiMode =
  | 'secretary'
  | 'management'
  | 'field'
  | 'admin'
  | 'sales'
  | 'welfare'

export interface AiModeConfig {
  id: AiMode
  label: string
  icon: string
  color: string
  prompts: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// ─── Briefing ─────────────────────────────────────────────
export type AlertLevel = 'danger' | 'warning' | 'info'

export interface BriefingItem {
  type: AlertLevel
  icon: string
  text: string
}

export interface Briefing {
  date: string
  greeting: string
  changes: BriefingItem[]
  topActions: string[]
}

// ─── Home Situation Cards ─────────────────────────────────
export interface SituationCard {
  id: string
  label: string
  value: string
  sub?: string
  alert?: boolean
  alertLevel?: 'danger' | 'warning'
  icon: string
  screen?: Screen
}

// ─── Task / Action Items ──────────────────────────────────
export interface TaskDetail {
  summary: string
  background: string
  recommendedActions: string[]
  replyDraft: string
  nextSteps: string[]
  relatedData: string[]
}

export interface ActionItem {
  id: string
  priority: Priority
  subject: string
  from: string
  deadline: string
  action: string
  category: string
  type: TaskType
  importance: Importance
  status: TaskStatus
  isRead: boolean
  detail: TaskDetail
}

// ─── Dashboard / Financial ────────────────────────────────
export interface DashboardMetric {
  id: string
  label: string
  value: string
  subValue?: string
  trend?: 'up' | 'down' | 'neutral'
  alert?: boolean
  alertLevel?: 'warning' | 'danger'
}

export interface CashflowWeek {
  week: string
  label: string
  income: number
  expense: number
  balance: number
  alert?: boolean
  alertLevel?: 'danger' | 'warning'
}

export interface ProjectMetric {
  id: string
  name: string
  client: string
  grossProfit: number
  grossProfitRate: number
  status: string
  alert?: boolean
}

export interface DepartmentMetric {
  id: string
  name: string
  revenue: number
  profit: number
  profitRate: number
}

// ─── Create Request ───────────────────────────────────────
export type OutputFormat =
  | 'chat'
  | 'gmail-draft'
  | 'drive'
  | 'manus'
  | 'claude-code'
  | 'gemini'

export interface CreateTemplate {
  id: string
  label: string
  icon: string
  description: string
  category: string
}

export interface CreationFormData {
  purpose: string
  recipient: string
  background: string
  content: string
  tone: string
  outputFormat: OutputFormat
}

// ─── Settings / Integrations ──────────────────────────────
export type ConnectionStatus = 'connected' | 'planned' | 'auth-required'

export interface Integration {
  id: string
  name: string
  icon: string
  status: ConnectionStatus
  readMode: string
  note: string
  lastSync?: string
}

// ─── Companies ────────────────────────────────────────────
export interface Company {
  id: string
  name: string
  shortName: string
}

// ─── API Integration Points ───────────────────────────────
export interface ApiIntegrationPoint {
  feature: string
  endpoint: string
  provider: string
  note: string
  phase: number
}
