// Stub for 社長承認フロー（将来）
// 将来: 承認フローエンジンを接続する

import type { ProviderDescriptor, UnifiedWorkflowItem } from './providerTypes'

export const workflowProvider = {
  getDescriptor(): ProviderDescriptor {
    return {
      providerId: 'workflow-approval',
      providerName: '社長承認フロー',
      providerType: 'workflow',
      sourceService: '社内承認システム',
      connectionStatus: 'planned',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: 'unknown',
      errors: [],
      warnings: [],
      nextPhase: '社長承認フロー（将来）',
    }
  },

  async getItems(): Promise<UnifiedWorkflowItem[]> {
    return []
  },

  async refresh(): Promise<void> {
    // stub
  },
}
