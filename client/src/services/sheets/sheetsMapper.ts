// Google Sheets 表データ → UnifiedBusinessMetric 変換
// Mission 1.3: spreadsheets.readonly の実データを変換する（書き込みなし）
//
// 想定シートフォーマット（docs/SHEETS_DATA_FORMAT.md 参照）:
//   A: metricKey   B: metricName  C: category  D: value
//   E: unit        F: period      G: status    H: alertReason（任意）
//   1行目がヘッダー（metricKey/key/項目 等）の場合はスキップ

import type { UnifiedBusinessMetric, UnifiedBusinessDataset } from '../../core/providers/providerTypes'
import type { GoogleSheetValues } from './types'

const VALID_CATEGORIES: UnifiedBusinessMetric['category'][] = [
  '売上', '粗利', '資金繰り', '請求', '未回収', '外注費', '事故', '稼働率', 'その他',
]

function normalizeCategory(raw: string): UnifiedBusinessMetric['category'] {
  const c = (raw ?? '').trim()
  return (VALID_CATEGORIES as string[]).includes(c) ? (c as UnifiedBusinessMetric['category']) : 'その他'
}

function normalizeStatus(raw: string): UnifiedBusinessMetric['status'] {
  const s = (raw ?? '').trim().toLowerCase()
  if (s === 'danger' || s === '危険') return 'danger'
  if (s === 'warning' || s === '注意') return 'warning'
  return 'normal'
}

// "¥1,234,000" "45.2%" "1,200" 等を数値へ
function parseNumber(raw: string): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[¥$,％%\s]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function isHeaderRow(row: string[]): boolean {
  const first = (row[0] ?? '').trim().toLowerCase()
  return first === 'metrickey' || first === 'key' || first === 'metric' || first === '項目' || first === 'キー'
}

// Google Sheets の生データ（values[][]）を UnifiedBusinessMetric[] に変換する（ReadOnly）
export function mapSheetValuesToMetrics(
  values: GoogleSheetValues,
  sourceLabel: string
): UnifiedBusinessMetric[] {
  const rows = values?.values ?? []
  const metrics: UnifiedBusinessMetric[] = []
  const nowIso = new Date().toISOString()

  rows.forEach((row, idx) => {
    if (idx === 0 && isHeaderRow(row)) return
    const metricKey = (row[0] ?? '').trim()
    if (!metricKey) return // キー無しの空行はスキップ

    const metricName = (row[1] ?? metricKey).trim()
    const category = normalizeCategory(row[2] ?? '')
    const value = parseNumber(row[3] ?? '')
    const unit = (row[4] ?? '').trim()
    const period = (row[5] ?? '').trim()
    const status = normalizeStatus(row[6] ?? '')
    const alertReason = (row[7] ?? '').trim() || null

    metrics.push({
      id: `sheet-${sourceLabel}-${metricKey}-${idx}`,
      source: sourceLabel,
      providerType: 'business-data',
      metricKey,
      metricName,
      category,
      value,
      unit,
      period,
      previousValue: null,
      changeAmount: null,
      changeRate: null,
      status,
      riskLevel: status === 'danger' ? 'high' : status === 'warning' ? 'medium' : null,
      relatedCompany: null,
      relatedDepartment: null,
      relatedProject: null,
      suggestedAction: null,
      dataSourceName: sourceLabel,
      lastUpdatedAt: nowIso,
      alertLevel: status === 'danger' ? 'danger' : status === 'warning' ? 'warning' : null,
      alertReason,
      label: metricName,
      trend: null,
      readOnly: true,
      writeEnabled: false,
    })
  })

  return metrics
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
