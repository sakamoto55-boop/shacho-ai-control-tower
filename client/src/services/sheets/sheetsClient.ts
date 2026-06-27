import { googleToken } from '../google/googleToken'
import { sheetsCache } from './sheetsCache'
import { mockBusinessDataset } from './mockSheets'
import type { UnifiedBusinessDataset } from '../../core/providers/providerTypes'

export interface SheetsFetchResult {
  dataset: UnifiedBusinessDataset
  source: 'mock' | 'cache' | 'api'
}

export const sheetsClient = {
  async fetchDataset(): Promise<SheetsFetchResult> {
    // 認証なし → デモデータ
    if (!googleToken.hasToken()) {
      return { dataset: mockBusinessDataset, source: 'mock' }
    }

    // キャッシュ有効なら返す
    const cached = sheetsCache.get()
    if (cached) return { dataset: cached, source: 'cache' }

    // 本番 API 接続（Phase 8 stub: シートID未設定なら mock）
    try {
      // TODO: Phase 8 本番接続 — hasAllSheetIds() が true になったら API 呼び出し
      // 現時点ではシートIDが未設定のため mock にフォールバック
      return { dataset: mockBusinessDataset, source: 'mock' }
    } catch {
      // エラー時は stale キャッシュ or mock
      const stale = sheetsCache.get()
      if (stale) return { dataset: stale, source: 'cache' }
      return { dataset: mockBusinessDataset, source: 'mock' }
    }
  },

  async refreshDataset(): Promise<void> {
    sheetsCache.clear()
    await this.fetchDataset()
  },

  isUsingMock(): boolean {
    return !googleToken.hasToken()
  },
}
