// アクション提案エンジン
// 推奨アクションを生成するのみ — 外部書き込みは行わない

import type { UnifiedInboxItem, UnifiedRisk, UnifiedActionSuggestion } from '../providers/providerTypes'

export const actionEngine = {
  suggestFromInbox(items: UnifiedInboxItem[]): UnifiedActionSuggestion[] {
    const now = new Date().toISOString()
    return items
      .filter((item) => item.priority === 'A' || item.replyDraftAvailable)
      .slice(0, 5)
      .map((item): UnifiedActionSuggestion => ({
        id: `action-inbox-${item.id}`,
        triggerSources: [item.source],
        actionType: item.replyDraftAvailable ? 'reply-draft' : 'review',
        title: item.replyDraftAvailable
          ? `返信下書きを確認: ${item.subject}`
          : `要確認: ${item.subject}`,
        description: `${item.from} からのメールです。${item.deadline ? `期限: ${item.deadline}` : ''}`,
        priority: item.priority,
        estimatedImpact: item.priority === 'A' ? '高（即日対応推奨）' : '中（本日中に確認）',
        requiresApproval: true,
        writeEnabled: false,
        suggestedAt: now,
      }))
  },

  suggestFromRisks(risks: UnifiedRisk[]): UnifiedActionSuggestion[] {
    const now = new Date().toISOString()
    return risks
      .filter((r) => r.severity === 'critical' || r.severity === 'high')
      .slice(0, 3)
      .map((risk): UnifiedActionSuggestion => ({
        id: `action-risk-${risk.id}`,
        triggerSources: risk.sources,
        actionType: 'alert',
        title: `【要対応】${risk.title}`,
        description: risk.description,
        priority: risk.severity === 'critical' ? 'A' : 'B',
        estimatedImpact: risk.severity === 'critical' ? '重大（即日対応必須）' : '高（本日中に対応）',
        requiresApproval: true,
        writeEnabled: false,
        suggestedAt: now,
      }))
  },

  // 将来: suggestFromSchedule(), suggestFromBusinessData()
}
