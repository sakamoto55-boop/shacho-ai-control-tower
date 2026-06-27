// Project SHOGUN — Morning Briefing Engine
// 全Provider横断（Inbox / Schedule / Files / BusinessData / Notification）の
// 統合判断を「社長がやる / 任せる / AIが監視」の3分類に整理し、
// 朝のブリーフィングテキストを生成する。
//
// 構造: Provider → AI Engine(aiOrchestrator) → morningBriefingEngine → チャット
// 書き込み禁止: 読み取り専用ロジックのみ。外部送信・実行は一切行わない。

import type { OrchestratorResult, DecisionItem } from './aiEngineTypes'

export type BriefingBucket = 'ceo' | 'delegate' | 'monitor'

export interface BriefingItem {
  id: string
  title: string
  reason: string
  suggestedAction: string
  timeEstimate: string
  importance: DecisionItem['importance']
  urgency: DecisionItem['urgency']
  category: DecisionItem['category']
}

export interface MorningBriefing {
  greeting: string
  generatedAt: string
  totalCount: number
  ceoActions: BriefingItem[]
  delegateActions: BriefingItem[]
  aiMonitorItems: BriefingItem[]
  monitoredCount: number // AIが裏で監視し続ける件数（リスク等）
  readOnly: true
  writeEnabled: false
}

// 時間帯に応じた挨拶（朝はおはようございます）
function timeGreeting(date: Date): string {
  const h = date.getHours()
  if (h < 11) return 'おはようございます'
  if (h < 17) return 'お疲れ様です'
  return 'こんばんは'
}

function toItem(d: DecisionItem): BriefingItem {
  return {
    id: d.id,
    title: d.title,
    reason: d.reason,
    suggestedAction: d.suggestedAction,
    timeEstimate: d.timeEstimate,
    importance: d.importance,
    urgency: d.urgency,
    category: d.category,
  }
}

// 1件の決断を 3分類に振り分ける（ceo > delegate > monitor の優先順）
function classify(d: DecisionItem): BriefingBucket {
  // 社長がやる: 承認が必要 / 緊急 / 銀行・事故・請求の重要A（社長判断が必須の領域）
  const ceoOnly =
    d.requiresApproval ||
    d.urgency === 'critical' ||
    (d.importance === 'A' &&
      (d.category === 'bank' || d.category === 'accident' || d.category === 'billing'))
  if (ceoOnly) return 'ceo'

  // 任せる: 担当に振れるもの（優先度B / 現場・人員 / 低緊急でないA案件）
  const delegatable =
    d.importance === 'B' ||
    d.category === 'field' ||
    d.category === 'personnel' ||
    (d.importance === 'A' && d.urgency !== 'low')
  if (delegatable) return 'delegate'

  // それ以外: AIが監視（FYI・低優先・記録のみ）
  return 'monitor'
}

// OrchestratorResult（全5Provider統合済み）から朝ブリーフィングを構築
export function buildMorningBriefing(result: OrchestratorResult): MorningBriefing {
  const now = new Date()
  const decisions = result.todayPlan.decisions

  const ceoActions: BriefingItem[] = []
  const delegateActions: BriefingItem[] = []
  const aiMonitorItems: BriefingItem[] = []

  for (const d of decisions) {
    const bucket = classify(d)
    if (bucket === 'ceo') ceoActions.push(toItem(d))
    else if (bucket === 'delegate') delegateActions.push(toItem(d))
    else aiMonitorItems.push(toItem(d))
  }

  const totalCount = ceoActions.length + delegateActions.length + aiMonitorItems.length

  // AIが裏で監視し続ける件数（横断リスク全体。表示中の決断は除く目安）
  const monitoredCount = result.risks.length

  return {
    greeting: timeGreeting(now),
    generatedAt: now.toISOString(),
    totalCount,
    ceoActions,
    delegateActions,
    aiMonitorItems,
    monitoredCount,
    readOnly: true,
    writeEnabled: false,
  }
}

// Project SHOGUN 標準UI: 朝ブリーフィングの定型テキスト
// 必ず「残りは私が監視します。」で締める。
export function formatMorningBriefing(b: MorningBriefing): string {
  const lines: string[] = []

  lines.push(`${b.greeting}、社長。`)
  lines.push('')

  if (b.totalCount === 0) {
    lines.push('今日は対応が必要な案件はありません。')
    lines.push('')
    lines.push('残りは私が監視します。')
    return lines.join('\n')
  }

  lines.push(`今日は${b.totalCount}件あります。`)
  lines.push(`🔴 社長がやる：${b.ceoActions.length}件`)
  lines.push(`🟡 任せる：${b.delegateActions.length}件`)
  lines.push(`🟢 AIが監視：${b.aiMonitorItems.length}件`)

  if (b.ceoActions.length > 0) {
    lines.push('')
    lines.push('【🔴 社長がやる】')
    b.ceoActions.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(`   理由：${it.reason}`)
      lines.push(`   → ${it.suggestedAction}（${it.timeEstimate}）`)
    })
  }

  if (b.delegateActions.length > 0) {
    lines.push('')
    lines.push('【🟡 任せる】')
    b.delegateActions.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(`   → ${it.suggestedAction}`)
    })
  }

  if (b.aiMonitorItems.length > 0) {
    lines.push('')
    lines.push('【🟢 AIが監視】')
    b.aiMonitorItems.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
    })
  }

  lines.push('')
  lines.push('残りは私が監視します。')

  return lines.join('\n')
}
