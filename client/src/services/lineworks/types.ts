// LINE WORKS 固有型定義（読み取り専用）
// 書き込み系操作（送信・既読化・削除・投稿）は一切定義しない

export type LineWorksMessageCategory =
  | 'accident'
  | 'absence'
  | 'delay'
  | 'sos'
  | 'vehicle'
  | 'finance'
  | 'operation'
  | 'other'

export type LineWorksUrgency = 'critical' | 'high' | 'medium' | 'low'

export type LineWorksChannelType = 'direct' | 'group' | 'announce'

export interface LineWorksMember {
  userId: string
  displayName: string
  department: string | null
  roleType: 'admin' | 'member' | 'guest'
}

export interface LineWorksChannel {
  channelId: string
  channelName: string
  channelType: LineWorksChannelType
  memberCount: number
}

export interface LineWorksMessage {
  messageId: string
  channelId: string
  channelName: string
  senderId: string
  senderName: string
  senderDepartment: string | null
  content: string
  sentAt: string // ISO 8601
  category: LineWorksMessageCategory
  urgency: LineWorksUrgency
  hasAttachment: boolean
  isRead: boolean
  // 読み取り専用フラグ
  readOnly: true
  writeEnabled: false
}

// LINE WORKS Inbox メッセージ（社内連絡・承認依頼系）
export interface LineWorksInboxMessage extends LineWorksMessage {
  requiresApproval: boolean
  priority: 'A' | 'B' | 'C'
  subject: string
  bodyPreview: string
  deadline: string | null
  suggestedAction: string | null
}

// LINE WORKS Notification メッセージ（緊急通知・アラート系）
export interface LineWorksNotificationMessage extends LineWorksMessage {
  riskFlag: boolean
  importance: 'A' | 'B' | 'C'
  suggestedAction: string | null
  relatedLocation: string | null
}
