// Gmail読み取り専用 — 書き込み系処理は一切実装しない

export interface GmailMessage {
  id: string
  threadId: string
  subject: string
  from: string
  fromEmail: string
  date: Date
  snippet: string
  body: string
  hasAttachment: boolean
  isUnread: boolean
  labels: string[]
  readonly writeProtected: true
}

export type GmailTaskType = 'メール' | '銀行' | '請求' | '契約' | '事故' | '営業' | '福祉' | 'その他'
export type GmailPriority = 'A' | 'B' | 'C'

export interface GmailDerivedTask {
  id: string
  gmailMessageId: string
  subject: string
  from: string
  receivedAt: Date
  summary: string
  priority: GmailPriority
  taskType: GmailTaskType
  estimatedDeadline: string | null
  recommendedAction: string
  replyDraft: string
  relatedKeywords: string[]
  source: 'gmail'
  writeProtected: true
  replyStatus: '未送信'
  requiresApproval: true
}

export type GmailFetchRange = '24h' | '3d' | '7d'

export interface GmailSummary {
  totalCount: number
  priorityACount: number
  todayDueCount: number
  bankCount: number
  billingCount: number
  contractCount: number
  accidentCount: number
  replyDraftCount: number
  topItems: GmailMessage[]
  safetyNotice: string
}

export interface GmailConnectionStatus {
  // Phase 11: 本番 Gmail 接続時に true。書き込みは常に不可。
  connected: boolean
  mode: 'demo' | 'production'
  lastFetchAt: Date | null
  itemCount: number
  permission: '読み取り専用'
  writeEnabled: false
  scope: 'https://www.googleapis.com/auth/gmail.readonly'
}
