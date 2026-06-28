// Project SHOGUN — Morning Briefing Engine
// 全Provider横断（Inbox / Schedule / Files / BusinessData / Notification）の
// 統合判断を「社長がやる / 任せる / AIが監視」の3分類に整理し、
// 朝のブリーフィングテキストを生成する。
//
// 構造: Provider → AI Engine(aiOrchestrator) → morningBriefingEngine → チャット
// 書き込み禁止: 読み取り専用ロジックのみ。外部送信・実行は一切行わない。

import type { OrchestratorResult, DecisionItem } from './aiEngineTypes'

// 各Providerのデータ取得状況（実データ / デモ / 取得中）
export type ProviderSourceState = 'loading' | 'api' | 'cache' | 'mock'

export interface ProviderStatusMap {
  inbox: ProviderSourceState
  schedule: ProviderSourceState
  file: ProviderSourceState
  business: ProviderSourceState
  notification: ProviderSourceState
}

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

// データ取得状況の1行表示（実=実データ / 取=取得中 / デ=デモ）
function formatDataStatus(s: ProviderStatusMap): string {
  const label = (st: ProviderSourceState): string =>
    st === 'loading' ? '取得中' : st === 'mock' ? 'デモ' : '実データ'
  return `📡 データ：受信箱=${label(s.inbox)} / 予定=${label(s.schedule)} / ファイル=${label(s.file)} / 数字=${label(s.business)} / 通知=${label(s.notification)}`
}

// すべて実データ（api/cache）かどうか
export function isAllRealData(s: ProviderStatusMap): boolean {
  return (Object.values(s) as ProviderSourceState[]).every((v) => v === 'api' || v === 'cache')
}

// Project SHOGUN 標準UI: 朝ブリーフィングの定型テキスト
// 必ず「残りは私が監視します。」で締める。
// dataStatus を渡すと、締めの直前にデータ取得状況を表示する。
export function formatMorningBriefing(b: MorningBriefing, dataStatus?: ProviderStatusMap): string {
  const lines: string[] = []

  lines.push(`${b.greeting}、社長。`)
  lines.push('')

  if (b.totalCount === 0) {
    lines.push('今日は対応が必要な案件はありません。')
    lines.push('')
    if (dataStatus) lines.push(formatDataStatus(dataStatus))
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
  if (dataStatus) lines.push(formatDataStatus(dataStatus))
  lines.push('残りは私が監視します。')

  return lines.join('\n')
}
