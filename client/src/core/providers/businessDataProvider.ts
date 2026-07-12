import { googleToken } from '../../services/google/googleToken'
import { sheetsClient } from '../../services/sheets/sheetsClient'
import type { ProviderDescriptor, UnifiedBusinessMetric, UnifiedBusinessDataset } from './providerTypes'

export const businessDataProvider = {
  getDescriptor(): ProviderDescriptor {
    const hasToken = googleToken.hasToken()
    return {
      providerId: 'google-sheets',
      providerName: 'Google Sheets（経営データ）',
      providerType: 'business-data',
      sourceService: 'Google Sheets',
      connectionStatus: hasToken ? 'connected' : 'disconnected',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: hasToken ? 'healthy' : 'degraded',
      errors: [],
      warnings: hasToken ? [] : ['未認証のためデモデータを表示中'],
      nextPhase: '経営数字をAI判断へ反映（Phase 8完了済）',
    }
  },

  async getItems(): Promise<UnifiedBusinessMetric[]> {
    const result = await sheetsClient.fetchDataset()
    return result.dataset.metrics
  },

  async getDataset(): Promise<UnifiedBusinessDataset> {
    const result = await sheetsClient.fetchDataset()
    return result.dataset
  },

  async refresh(): Promise<void> {
    await sheetsClient.refreshDataset()
  },

  isUsingDemo(): boolean {
    return sheetsClient.isUsingMock()
  },
}
