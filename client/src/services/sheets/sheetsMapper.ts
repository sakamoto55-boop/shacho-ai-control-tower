// Google Sheets 表データ → UnifiedBusinessMetric 変換
// Phase 8 では主に mockSheets のデータをそのまま渡すが、
// 本番接続後は fetchSheetValues の結果をここで変換する

import type { UnifiedBusinessMetric, UnifiedBusinessDataset } from '../../core/providers/providerTypes'
import type { GoogleSheetValues } from './types'

// 将来: Google Sheets の生データ（values[][]）を UnifiedBusinessMetric に変換する
// 現フェーズでは mockSheets のデータを直接使用する
export function mapSheetValuesToMetrics(
  _values: GoogleSheetValues,
  _sourceLabel: string
): UnifiedBusinessMetric[] {
  // Phase 8 stub: 本番接続後に実装
  // セル更新・行追加・削除は行わない（ReadOnly）
  return []
}

export function createDatasetFromMetrics(
  metrics: UnifiedBusinessMetric[],
  source: UnifiedBusinessDataset['source']
): Pick<UnifiedBusinessDataset, 'metrics' | 'source' | 'fetchedAt'> {
  return {
    metrics,
    source,
    fetchedAt: new Date().toISOString(),
  }
}
