// LINE WORKS → Unified型 変換マッパー

import type { LineWorksNotificationMessage, LineWorksInboxMessage } from './types'
import type { UnifiedNotification, UnifiedInboxItem } from '../../core/providers/providerTypes'

export function mapLineWorksToUnifiedNotification(
  msg: LineWorksNotificationMessage
): UnifiedNotification {
  return {
    id: msg.messageId,
    source: 'デモLINE WORKS',
    providerType: 'notification',
    type: msg.urgency === 'critical' ? 'alert' : 'warning',
    title: buildNotificationTitle(msg),
    body: msg.content,
    receivedAt: msg.sentAt,
    priority: msg.importance,
    sourceMessageId: msg.messageId,
    senderName: msg.senderName,
    senderDepartment: msg.senderDepartment ?? undefined,
    sentAt: msg.sentAt,
    category: msg.category,
    urgency: msg.urgency,
    importance: msg.importance,
    requiresAction: msg.riskFlag || msg.urgency === 'critical',
    suggestedAction: msg.suggestedAction ?? undefined,
    riskFlag: msg.riskFlag,
    isRead: msg.isRead,
    actionRequired: msg.urgency === 'critical' || msg.riskFlag,
    readOnly: true,
    writeEnabled: false,
  }
}

export function mapLineWorksToUnifiedInboxItem(
  msg: LineWorksInboxMessage
): UnifiedInboxItem {
  return {
    id: msg.messageId,
    source: 'デモLINE WORKS',
    providerType: 'inbox',
    from: `${msg.senderName}（LINE WORKS）`,
    fromName: msg.senderName,
    subject: msg.subject,
    bodyPreview: msg.bodyPreview,
    receivedAt: msg.sentAt,
    isRead: msg.isRead,
    hasAttachment: msg.hasAttachment,
    labels: ['LINE WORKS'],
    priority: msg.priority,
    taskType: categoryToTaskType(msg.category),
    deadline: msg.deadline,
    replyDraftAvailable: false,
    writeProtected: true,
    requiresApproval: true,
  }
}

function buildNotificationTitle(msg: LineWorksNotificationMessage): string {
  const categoryLabel: Record<string, string> = {
    accident: '事故報告',
    absence: '欠勤連絡',
    delay: '現場遅延',
    sos: 'SOS・緊急連絡',
    vehicle: '車両トラブル',
    finance: '財務連絡',
    operation: '業務連絡',
    other: '通知',
  }
  const prefix = msg.urgency === 'critical' ? '【緊急】' : '【要確認】'
  const label = categoryLabel[msg.category] ?? '通知'
  return `${prefix}${label}：${msg.senderName}（${msg.senderDepartment ?? msg.channelName}）`
}

function categoryToTaskType(category: LineWorksInboxMessage['category']): string {
  const map: Record<string, string> = {
    finance: '請求',
    operation: '業務',
    accident: '事故',
    absence: '人員',
    delay: '現場',
    sos: '緊急',
    vehicle: '現場',
    other: 'その他',
  }
  return map[category] ?? 'その他'
}
