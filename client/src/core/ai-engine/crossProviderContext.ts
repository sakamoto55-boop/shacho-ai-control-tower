// 全Provider横断テーマ検出エンジン
// 2つ以上のProviderにまたがる同一テーマを CrossProviderContext として生成する
// 書き込み禁止: 読み取り専用ロジックのみ

import type {
  CrossProviderContext,
  EvidenceSource,
  ApprovalStatus,
} from './aiEngineTypes'
import type {
  UnifiedInboxItem,
  UnifiedScheduleItem,
  UnifiedFileItem,
  UnifiedBusinessMetric,
  UnifiedNotification,
} from '../providers/providerTypes'

const THEMES: Record<string, string[]> = {
  '銀行対応': ['銀行', '融資', '審査', '試算表', '財務', '金庫', '信用金庫'],
  '未請求・未回収': ['未請求', '請求書', '未入金', '督促', '未回収', '請求確認', '入金'],
  '事故対応': ['事故', '接触', 'ケガ', '負傷', '報告書', '警察', '救急', '現場事故'],
  'SOS・緊急': ['SOS', '緊急', '意識', '救急車', '呼びかけ'],
  '人員不足': ['欠勤', '休み', '人手不足', 'シフト', '育休', '体調不良', '代替スタッフ'],
  '車両トラブル': ['車両', 'バン', 'トラック', 'エンジン', 'ロードサービス', '警告ランプ'],
  '現場遅延': ['遅延', '工程', '搬入', '現場', '配送遅延', '到着遅れ'],
  'お結び運営': ['お結び', '渋谷', 'パート', 'シフト', '店舗'],
}

function textOf(item: UnifiedInboxItem | UnifiedScheduleItem | UnifiedFileItem | UnifiedBusinessMetric | UnifiedNotification): string {
  if ('subject' in item) return `${item.subject ?? ''} ${item.bodyPreview ?? ''}`
  if ('title' in item && 'startAt' in item) return `${(item as UnifiedScheduleItem).title} ${(item as UnifiedScheduleItem).description ?? ''}`
  if ('name' in item) return `${(item as UnifiedFileItem).name} ${(item as UnifiedFileItem).category ?? ''} ${(item as UnifiedFileItem).relatedCompany ?? ''}`
  if ('metricKey' in item) return `${(item as UnifiedBusinessMetric).metricName} ${(item as UnifiedBusinessMetric).category} ${(item as UnifiedBusinessMetric).suggestedAction ?? ''}`
  if ('body' in item) return `${(item as UnifiedNotification).title} ${(item as UnifiedNotification).body}`
  return ''
}

function matchTheme(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw.toLowerCase()))
}

function urgencyFor(sources: EvidenceSource[]): CrossProviderContext['urgency'] {
  if (sources.some((s) => s.type === 'notification')) return 'critical'
  if (sources.length >= 3) return 'high'
  return 'medium'
}

function importanceFor(sources: EvidenceSource[], theme: string): CrossProviderContext['importance'] {
  if (theme === '事故対応' || theme === 'SOS・緊急') return 'A'
  if (sources.some((s) => s.type === 'metric')) return 'A'
  if (sources.length >= 3) return 'A'
  return 'B'
}

function riskLevelFor(theme: string, sourceCount: number): CrossProviderContext['riskLevel'] {
  if (theme === '事故対応' || theme === 'SOS・緊急') return 'critical'
  if (theme === '銀行対応' || theme === '未請求・未回収') return sourceCount >= 3 ? 'high' : 'medium'
  if (theme === '人員不足' || theme === '車両トラブル') return 'medium'
  return 'low'
}

export function buildCrossProviderContexts(
  inbox: UnifiedInboxItem[],
  schedule: UnifiedScheduleItem[],
  files: UnifiedFileItem[],
  metrics: UnifiedBusinessMetric[],
  notifications: UnifiedNotification[]
): CrossProviderContext[] {
  const results: CrossProviderContext[] = []
  const now = new Date().toISOString()

  for (const [theme, keywords] of Object.entries(THEMES)) {
    const evidenceSources: EvidenceSource[] = []

    for (const item of inbox) {
      if (matchTheme(textOf(item), keywords)) {
        evidenceSources.push({
          type: 'inbox',
          id: item.id,
          title: item.subject ?? '(件名なし)',
          snippet: item.bodyPreview?.slice(0, 60) ?? '',
          source: item.source,
        })
      }
    }

    for (const item of schedule) {
      if (matchTheme(textOf(item), keywords)) {
        evidenceSources.push({
          type: 'schedule',
          id: item.id,
          title: item.title,
          snippet: item.description?.slice(0, 60) ?? '',
          source: item.source,
        })
      }
    }

    for (const item of files) {
      if (matchTheme(textOf(item), keywords)) {
        evidenceSources.push({
          type: 'file',
          id: item.id,
          title: item.name,
          snippet: `${item.category ?? ''} ${item.relatedCompany ?? ''}`.trim(),
          source: item.source,
        })
      }
    }

    for (const item of metrics) {
      if (matchTheme(textOf(item), keywords)) {
        evidenceSources.push({
          type: 'metric',
          id: item.id,
          title: item.metricName,
          snippet: item.alertReason?.slice(0, 60) ?? `${item.value}${item.unit}`,
          source: item.source,
        })
      }
    }

    for (const item of notifications) {
      if (matchTheme(textOf(item), keywords)) {
        evidenceSources.push({
          type: 'notification',
          id: item.id,
          title: item.title,
          snippet: item.body.slice(0, 60),
          source: item.source,
        })
      }
    }

    // 2つ以上のProviderにまたがる場合のみ生成
    const sourceTypes = new Set(evidenceSources.map((e) => e.type))
    if (sourceTypes.size < 2) continue

    const urgency = urgencyFor(evidenceSources)
    const importance = importanceFor(evidenceSources, theme)
    const riskLevel = riskLevelFor(theme, evidenceSources.length)

    const ctx: CrossProviderContext = {
      id: `cross-${theme.replace(/[・\s]/g, '-')}-${now.slice(0, 10)}`,
      theme,
      title: `${theme}（${evidenceSources.length}件の情報が連動）`,
      summary: `${theme}に関する情報が${Array.from(sourceTypes).join('・')}にまたがって確認されています。`,
      importance,
      urgency,
      riskLevel,
      reason: `${evidenceSources.length}件の関連情報: ${evidenceSources.map((e) => e.title).slice(0, 3).join('、')}`,
      evidenceSources,
      suggestedAction: suggestActionForTheme(theme),
      requiresApproval: importance === 'A',
      approvalStatus: 'pending' as ApprovalStatus,
      readOnly: true,
      writeEnabled: false,
    }
    results.push(ctx)
  }

  // 重要度順にソート
  return results.sort((a, b) => {
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
  })
}

function suggestActionForTheme(theme: string): string {
  const map: Record<string, string> = {
    '銀行対応': '本日の銀行打合せ前に試算表・財務書類を確認し、必要書類を整えてください。',
    '未請求・未回収': '未請求一覧を確認し、請求書発行と督促連絡の優先順位を決めてください。',
    '事故対応': '事故報告書を確認し、保険会社・関係者への連絡と再発防止策を検討してください。',
    'SOS・緊急': '現場担当者と直接連絡を取り、状況を確認してください。',
    '人員不足': '代替スタッフの確保または求人対応の方針を決定してください。',
    '車両トラブル': '代替交通手段の確保と車両修理の手配を行ってください。',
    '現場遅延': '発注先への工程影響の連絡と、納期調整の可否を確認してください。',
    'お結び運営': 'シフト人員補充の方針（求人 or 応援）を決定してください。',
  }
  return map[theme] ?? '関連情報を確認し、必要なアクションを判断してください。'
}
