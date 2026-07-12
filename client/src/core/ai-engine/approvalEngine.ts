// 承認ゲートエンジン
// 外部APIへの書き込みは社長承認後のみ実行可能
// 現フェーズでは承認後の実行機能も未実装（提案・承認状態管理のみ）

import type { UnifiedActionSuggestion, UnifiedApprovalRequest } from '../providers/providerTypes'

export const GATE_MESSAGE =
  '社長の承認が必要です。外部APIへの書き込みは承認後のみ実行できます。'

export const approvalEngine = {
  requiresApproval(_suggestion: UnifiedActionSuggestion): true {
    return true
  },

  createApprovalRequest(
    suggestion: UnifiedActionSuggestion,
    targetService: string
  ): UnifiedApprovalRequest {
    return {
      id: `approval-${suggestion.id}-${Date.now()}`,
      requestType: suggestion.actionType === 'reply-draft' ? 'send-email' : 'external-action',
      title: suggestion.title,
      description: suggestion.description,
      targetService,
      requestedAt: new Date().toISOString(),
      status: 'pending',
      executeAfterApproval: true,
    }
  },

  canExecute(request: UnifiedApprovalRequest): boolean {
    return request.status === 'approved'
  },
}
