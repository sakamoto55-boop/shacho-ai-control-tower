// Google Drive ReadOnly — File Provider 実装
// 書き込みAPI（createFile / updateFile / deleteFile / moveFile / shareFile /
//              changePermission / uploadFile / copyFile）は完全未実装

import { googleToken } from '../../services/google/googleToken'
import { driveClient } from '../../services/drive/driveClient'
import { mapGoogleDriveFileToUnifiedFileItem } from '../../services/drive/driveMapper'
import type { ProviderDescriptor, UnifiedFileItem } from './providerTypes'

export const fileProvider = {
  getDescriptor(): ProviderDescriptor {
    const hasToken = googleToken.hasToken()
    return {
      providerId: 'google-drive',
      providerName: 'Google Drive',
      providerType: 'file',
      sourceService: 'Google Drive',
      connectionStatus: hasToken ? 'connected' : 'disconnected',
      readOnly: true,
      writeEnabled: false,
      lastSyncAt: null,
      healthStatus: hasToken ? 'healthy' : 'degraded',
      errors: [],
      warnings: hasToken ? [] : ['未認証のためデモデータを表示中'],
      nextPhase: 'Drive検索をAI検索・コックピットへ反映（Phase 7完了済）',
    }
  },

  async getItems(): Promise<UnifiedFileItem[]> {
    const result = await driveClient.fetchFiles()
    const sourceLabel = result.source === 'api' ? 'Google Drive' : 'デモDrive'
    return result.files
      .filter((f) => !f.trashed)
      .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, sourceLabel))
  },

  async refresh(): Promise<void> {
    await driveClient.refreshFiles()
  },

  isUsingDemo(): boolean {
    return driveClient.isUsingMock()
  },
}
