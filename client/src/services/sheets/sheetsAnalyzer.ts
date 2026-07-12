// 経営指標の危険度判定
import type { UnifiedBusinessMetric, UnifiedBusinessDataset } from '../../core/providers/providerTypes'

export type BusinessRiskType =
  | '資金繰りリスク'
  | '売上リスク'
  | '粗利リスク'
  | '未請求リスク'
  | '未回収リスク'
  | '事故リスク'
  | '稼働率リスク'

export interface BusinessRiskItem {
  riskType: BusinessRiskType
  severity: 'critical' | 'high' | 'medium' | 'low'
  metricId: string
  label: string
  description: string
  suggestedAction: string | null
}

export function detectBusinessRisks(metrics: UnifiedBusinessMetric[]): BusinessRiskItem[] {
  const risks: BusinessRiskItem[] = []

  for (const m of metrics) {
    if (m.status === 'danger' || m.status === 'warning') {
      let riskType: BusinessRiskType | null = null
      let severity: BusinessRiskItem['severity'] = 'medium'

      switch (m.category) {
        case '資金繰り':
          riskType = '資金繰りリスク'
          severity = m.status === 'danger' ? 'critical' : 'high'
          break
        case '売上':
          if (m.trend === 'down') { riskType = '売上リスク'; severity = 'medium' }
          break
        case '粗利':
          if (m.trend === 'down') { riskType = '粗利リスク'; severity = m.status === 'danger' ? 'high' : 'medium' }
          break
        case '請求':
          riskType = '未請求リスク'
          severity = m.status === 'danger' ? 'high' : 'medium'
          break
        case '未回収':
          riskType = '未回収リスク'
          severity = m.status === 'danger' ? 'high' : 'medium'
          break
        case '事故':
          riskType = '事故リスク'
          severity = m.value > 0 ? 'critical' : 'low'
          break
        case '稼働率':
          if (m.trend === 'down') { riskType = '稼働率リスク'; severity = 'low' }
          break
      }

      if (riskType) {
        risks.push({
          riskType,
          severity,
          metricId: m.id,
          label: m.metricName,
          description: m.alertReason ?? `${m.metricName}に注意が必要です`,
          suggestedAction: m.suggestedAction,
        })
      }
    }
  }

  return risks.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.severity] - order[b.severity]
  })
}

export function createBusinessSummary(dataset: UnifiedBusinessDataset): {
  dangerCount: number
  warningCount: number
  cashBalance: number | null
  unbilledAmount: number | null
  uncollectedAmount: number | null
  grossProfitRate: number | null
  accidentCount: number | null
} {
  const metrics = dataset.metrics
  return {
    dangerCount: metrics.filter((m) => m.status === 'danger').length,
    warningCount: metrics.filter((m) => m.status === 'warning').length,
    cashBalance: metrics.find((m) => m.metricKey === 'cash_balance')?.value ?? null,
    unbilledAmount: metrics.find((m) => m.metricKey === 'unbilled')?.value ?? null,
    uncollectedAmount: metrics.find((m) => m.metricKey === 'uncollected')?.value ?? null,
    grossProfitRate: metrics.find((m) => m.metricKey === 'gross_profit_rate')?.value ?? null,
    accidentCount: metrics.find((m) => m.metricKey === 'accident_count')?.value ?? null,
  }
}
