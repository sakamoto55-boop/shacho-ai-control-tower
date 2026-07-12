// Google Sheets クライアント（ReadOnly）
// Mission 1.3: spreadsheets.readonly の実データ取得に対応。
//   - 認証なし          → デモ（mock）
//   - シートID未設定     → 未設定（unconfigured・デモへフォールバック）
//   - 取得成功          → 実データ（api）
//   - 取得失敗          → 取得失敗（error・デモへフォールバック）
// 書き込み（セル更新・行追加・削除・シート作成）は一切実装しない。

import { googleToken } from '../google/googleToken'
import { sheetsCache } from './sheetsCache'
import { mockBusinessDataset } from './mockSheets'

const emptyDataset: UnifiedBusinessDataset = { metrics: [], cashflowWeeks: [], projectProfits: [], departmentMetrics: [], source: 'api', fetchedAt: new Date(0).toISOString() }
import { SHEET_TARGETS, getSheetId } from './sheetsRegistry'
import { fetchSheetValues } from './sheetsFetcher'
import { mapSheetValuesToMetrics } from './sheetsMapper'
import type { UnifiedBusinessMetric, UnifiedBusinessDataset } from '../../core/providers/providerTypes'

export type SheetsSource = 'mock' | 'cache' | 'api' | 'unconfigured' | 'error'

export interface SheetsFetchResult {
  dataset: UnifiedBusinessDataset
  source: SheetsSource
}

export const sheetsClient = {
  async fetchDataset(): Promise<SheetsFetchResult> {
    // 認証なし → デモデータ
    if (!googleToken.hasToken()) {
      return { dataset: mockBusinessDataset, source: 'mock' }
    }

    // 設定済みシートID（環境変数）を収集
    const configured = SHEET_TARGETS
      .map((t) => ({ target: t, id: getSheetId(t.envKey) }))
      .filter((x): x is { target: typeof SHEET_TARGETS[number]; id: string } => x.id !== null)

    // シートID未設定 → 未設定（デモへフォールバック）
    if (configured.length === 0) {
      return { dataset: emptyDataset, source: 'unconfigured' }
    }

    // キャッシュ有効なら返す
    const cached = sheetsCache.get()
    if (cached) return { dataset: cached, source: 'cache' }

    // 本番 API 接続（GET のみ・書き込みなし）
    try {
      const accessToken = googleToken.getOrThrow()
      const metrics: UnifiedBusinessMetric[] = []
      for (const { target, id } of configured) {
        const values = await fetchSheetValues(accessToken, id, target.range)
        metrics.push(...mapSheetValuesToMetrics(values, target.name))
      }

      // 取得できたが解析結果が0件 → フォーマット不一致として取得失敗扱い
      if (metrics.length === 0) {
        const stale = sheetsCache.get()
        if (stale) return { dataset: stale, source: 'cache' }
        return { dataset: emptyDataset, source: 'error' }
      }

      const dataset: UnifiedBusinessDataset = {
        metrics,
        cashflowWeeks: [],
        projectProfits: [],
        departmentMetrics: [],
        source: 'api',
        fetchedAt: new Date().toISOString(),
      }
      sheetsCache.set(dataset)
      return { dataset, source: 'api' }
    } catch {
      // エラー時は stale キャッシュ or デモ（取得失敗）
      const stale = sheetsCache.get()
      if (stale) return { dataset: stale, source: 'cache' }
      return { dataset: emptyDataset, source: 'error' }
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
