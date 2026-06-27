// リスク横断検知エンジン
// 将来: inbox + schedule + businessData + workflow を横断してリスクを検知

import type { UnifiedInboxItem, UnifiedBusinessMetric, UnifiedRisk } from '../providers/providerTypes'

const RISK_KEYWORDS: Record<string, UnifiedRisk['riskType']> = {
  '事故': '事故',
  '労災': '事故',
  '怪我': '事故',
  '未払い': '未回収',
  '未回収': '未回収',
  '未請求': '未請求',
  '資金': '資金繰り',
  '口座残高': '資金繰り',
  '契約終了': '契約期限',
  '期限': '契約期限',
  '人員不足': '人員不足',
  '退職': '人員不足',
}

export const riskEngine = {
  detectFromInbox(items: UnifiedInboxItem[]): UnifiedRisk[] {
    const risks: UnifiedRisk[] = []
    const now = new Date().toISOString()

    for (const item of items) {
      const text = `${item.subject} ${item.bodyPreview} ${item.taskType}`

      for (const [keyword, riskType] of Object.entries(RISK_KEYWORDS)) {
        if (text.includes(keyword)) {
          risks.push({
            id: `risk-inbox-${item.id}-${riskType}`,
            sources: ['gmail'],
            riskType,
            severity: item.priority === 'A' ? 'high' : 'medium',
            title: `${riskType}リスク: ${item.subject}`,
            description: item.bodyPreview.slice(0, 100),
            detectedAt: now,
            deadline: item.deadline,
          })
          break
        }
      }
    }

    return risks
  },

  detectFromBusinessData(metrics: UnifiedBusinessMetric[]): UnifiedRisk[] {
    const risks: UnifiedRisk[] = []
    const now = new Date().toISOString()

    for (const metric of metrics) {
      if (metric.alertLevel === 'danger' && metric.category === '資金繰り') {
        risks.push({
          id: `risk-business-${metric.id}`,
          sources: [metric.source],
          riskType: '資金繰り',
          severity: 'critical',
          title: `資金繰りリスク: ${metric.metricName}`,
          description: metric.alertReason ?? '資金繰りに注意が必要です',
          detectedAt: now,
          deadline: null,
        })
      } else if (metric.alertLevel === 'warning' && metric.category === '未回収') {
        risks.push({
          id: `risk-business-${metric.id}`,
          sources: [metric.source],
          riskType: '未回収',
          severity: 'high',
          title: `未回収リスク: ${metric.metricName}`,
          description: metric.alertReason ?? '未回収金額が発生しています',
          detectedAt: now,
          deadline: null,
        })
      } else if (metric.category === '請求' && (metric.status === 'danger' || metric.status === 'warning')) {
        risks.push({
          id: `risk-business-${metric.id}-billing`,
          sources: [metric.source],
          riskType: '未請求',
          severity: metric.status === 'danger' ? 'high' : 'medium',
          title: `未請求リスク: ${metric.metricName}`,
          description: metric.alertReason ?? '未請求金額が発生しています',
          detectedAt: now,
          deadline: null,
        })
      } else if (metric.category === '事故' && metric.value > 0) {
        risks.push({
          id: `risk-business-${metric.id}-accident`,
          sources: [metric.source],
          riskType: '事故',
          severity: 'critical',
          title: `事故リスク: ${metric.metricName}`,
          description: metric.alertReason ?? '事故が発生しています。報告書を確認してください',
          detectedAt: now,
          deadline: null,
        })
      } else if (metric.category === '粗利' && metric.trend === 'down' && metric.status !== 'normal') {
        risks.push({
          id: `risk-business-${metric.id}-profit`,
          sources: [metric.source],
          riskType: 'その他',
          severity: 'medium',
          title: `粗利悪化リスク: ${metric.metricName}`,
          description: metric.alertReason ?? '粗利率が低下しています',
          detectedAt: now,
          deadline: null,
        })
      }
    }

    return risks
  },

  aggregateRisks(...riskArrays: UnifiedRisk[][]): UnifiedRisk[] {
    const all = riskArrays.flat()
    const seen = new Set<string>()
    return all.filter((r) => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    }).sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      return order[a.severity] - order[b.severity]
    })
  },

  // 将来: detectFromSchedule(), detectFromWorkflow()
}
