// Connects Gmail + LINE WORKS → UnifiedInboxItem[]
// Phase 9: LINE WORKS inbox items added

import type { ProviderDescriptor, UnifiedInboxItem } from './providerTypes'
import type { GmailDerivedTask } from '../../types'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { mapToGmailDerivedTask } from '../../services/gmail/gmailMapper'
import { googleToken } from '../../services/google/googleToken'
import { lineworksClient } from '../../services/lineworks/lineworksClient'
import { mapLineWorksToUnifiedInboxItem } from '../../services/lineworks/lineworksMapper'

export function mapGmailDerivedTaskToUnifiedInboxItem(task: GmailDerivedTask): UnifiedInboxItem {
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
}

export const inboxProvider = {
  getDescriptor(): ProviderDescriptor {
    const hasToken = googleToken.hasToken()
    return {
      providerId: 'gmail-inbox',
      providerName: 'Gmail 受信トレイ',
      providerType: 'inbox',
      sourceService: 'Gmail',
      connectionStatus: hasToken ? 'connected' : 'disconnected',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: hasToken ? 'healthy' : 'degraded',
      errors: [],
      warnings: hasToken ? [] : ['Google認証が未設定です。デモデータを使用しています。'],
      nextPhase: 'LINE WORKS（未定）',
    }
  },

  async getItems(): Promise<UnifiedInboxItem[]> {
    const tasks = mockGmailMessages.map(mapToGmailDerivedTask)
    const gmailItems = tasks.map(mapGmailDerivedTaskToUnifiedInboxItem)
    const lwResult = await lineworksClient.fetchInboxMessages()
    const lwItems = lwResult.data.map(mapLineWorksToUnifiedInboxItem)
    return [...gmailItems, ...lwItems]
  },

  async refresh(): Promise<void> {
    // stub: 将来的に gmailClient.refreshMessages() を呼び出す
  },
}
