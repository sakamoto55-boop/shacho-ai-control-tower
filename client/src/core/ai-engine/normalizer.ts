// Normalizes per-service data into unified types
// As new providers are added, add their normalizers here

import type { GmailDerivedTask } from '../../types'
import type { UnifiedInboxItem } from '../providers/providerTypes'

export const normalizer = {
  gmailToInboxItem(task: GmailDerivedTask): UnifiedInboxItem {
    return {
      id: task.id,
      source: 'gmail',
      providerType: 'inbox',
      from: task.from,
      fromName: task.from,
      subject: task.subject,
      bodyPreview: task.summary,
      receivedAt: task.receivedAt.toISOString(),
      isRead: false,
      hasAttachment: false,
      labels: [],
      priority: task.priority,
      taskType: task.taskType,
      deadline: task.estimatedDeadline,
      replyDraftAvailable: task.replyDraft.length > 0,
      writeProtected: true,
      requiresApproval: true,
    }
  },

  // 将来: calendarEventToScheduleItem()
  // 将来: driveFileToFileItem()
  // 将来: sheetsRowToBusinessMetric()
  // 将来: freeeDataToBusinessMetric()
  // 将来: lineWorksMessageToInboxItem()
}
