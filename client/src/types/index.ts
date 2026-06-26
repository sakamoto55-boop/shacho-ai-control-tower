export type Screen = 'home' | 'chat' | 'actions' | 'create' | 'dashboard' | 'settings'

export type Priority = 'A' | 'B' | 'waiting-confirm' | 'waiting-create'

export type Company = 'lcc' | 'uetake' | 'global-bridge' | 'mirai'

export interface ActionItem {
  id: string
  priority: Priority
  subject: string
  from: string
  deadline: string
  action: string
  category: string
  isRead: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface DashboardMetric {
  id: string
  label: string
  value: string
  subValue?: string
  trend?: 'up' | 'down' | 'neutral'
  alert?: boolean
  alertLevel?: 'warning' | 'danger'
}

export interface CreateTemplate {
  id: string
  label: string
  icon: string
  description: string
  category: string
}

export interface Connection {
  id: string
  name: string
  status: 'connected' | 'planned' | 'disconnected'
  icon: string
}
