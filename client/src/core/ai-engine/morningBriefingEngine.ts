// Project SHOGUN — Morning Briefing Engine（Mission 1.2: Overnight Review）
// 本体は「前日の全データ（昨日23:00〜今日7:00）をAIが全件読む」こと。
// Morning Briefing はその結果。全Provider横断で以下を社長へ提示する。
//   1. 社長が判断すべきもの
//   2. 返信していない重要案件
//   3. 今日が期限のもの
//   4. AIが担当へ回した方がよいもの（任せる）
//   5. AIが監視だけ続けるもの
//   + 返信状況分析（返信なし / 相手未読 / 返信済み / 催促あり）※推定
// 必ず「残りは私が監視します。」で締める。
// 書き込み禁止: 読み取り専用ロジックのみ。

import type { OrchestratorResult, DecisionItem } from './aiEngineTypes'
import type { UnifiedInboxItem } from '../providers/providerTypes'

// 夜間レビューの読み取り対象（全Providerの統合入力）
export interface BriefingInput {
  inbox: UnifiedInboxItem[]
  scheduleCount: number
  fileCount: number
  metricCount: number
  notificationCount: number
}

// 各Providerのデータ取得状況（実データ / デモ / 取得中 / 未設定 / 取得失敗）
export type ProviderSourceState = 'loading' | 'api' | 'cache' | 'mock' | 'unconfigured' | 'error'

export interface ProviderStatusMap {
  inbox: ProviderSourceState
  schedule: ProviderSourceState
  file: ProviderSourceState
  business: ProviderSourceState
  notification: ProviderSourceState
}

// 返信状況（※ readonly のため推定。相手未読は Re: スレッド等からの推定）
export type ReplyState = 'no_reply' | 'recipient_unread' | 'replied' | 'reminder'

export interface ReplyStatusSummary {
  noReply: number
  recipientUnread: number
  replied: number
  reminder: number
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

// 受信箱由来の表示行（返信していない重要案件 / 今日期限）
export interface BriefLine {
  id: string
  title: string
  sub: string
}

export interface MorningBriefing {
  greeting: string
  generatedAt: string
  windowLabel: string
  totalReviewed: number // AIが読んだ全件数（夜間レビュー）
  totalCount: number // 今日の対応件数（ceo+delegate+monitor）
  ceoActions: BriefingItem[]
  unrepliedImportant: BriefLine[]
  dueToday: BriefLine[]
  delegateActions: BriefingItem[]
  aiMonitorItems: BriefingItem[]
  replyStatus: ReplyStatusSummary
  monitoredCount: number
  readOnly: true
  writeEnabled: false
}

// ── ユーティリティ ──────────────────────────────────────────────

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

function classify(d: DecisionItem): BriefingBucket {
  const ceoOnly =
    d.requiresApproval ||
    d.urgency === 'critical' ||
    (d.importance === 'A' &&
      (d.category === 'bank' || d.category === 'accident' || d.category === 'billing'))
  if (ceoOnly) return 'ceo'

  const delegatable =
    d.importance === 'B' ||
    d.category === 'field' ||
    d.category === 'personnel' ||
    (d.importance === 'A' && d.urgency !== 'low')
  if (delegatable) return 'delegate'

  return 'monitor'
}

// 催促を示すキーワード（返信状況の推定に使用）
const REMINDER_RE = /督促|催促|再送|再度|至急|リマインド|ご確認ください|お返事|ご返信|いかがでしょうか|まだ.{0,6}(返|連絡)/

// 1件の受信箱アイテムの返信状況を推定する
function replyStateOf(i: UnifiedInboxItem): ReplyState {
  const text = `${i.subject} ${i.bodyPreview}`
  if (REMINDER_RE.test(text)) return 'reminder' // 催促あり（最優先）
  if (!i.isRead || i.replyDraftAvailable) return 'no_reply' // 未読 or 下書きのみ＝未返信
  if (/^re:/i.test(i.subject.trim())) return 'recipient_unread' // Re:スレッド＝相手の反応待ち（推定）
  return 'replied' // 既読・下書きなし＝対応済み（推定）
}

// 期限が今日かどうか
function isDueToday(deadline: string | null): boolean {
  if (!deadline) return false
  if (deadline.includes('今日') || deadline.includes('本日')) return true
  const t = new Date(deadline)
  if (Number.isNaN(t.getTime())) return false
  const now = new Date()
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  )
}

// ── 構築 ────────────────────────────────────────────────────────

export function buildMorningBriefing(
  result: OrchestratorResult,
  input?: BriefingInput
): MorningBriefing {
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

  // ── 夜間レビュー（受信箱の全件読み込み結果）──
  const inbox = input?.inbox ?? []
  const replyStatus: ReplyStatusSummary = { noReply: 0, recipientUnread: 0, replied: 0, reminder: 0 }
  const unrepliedImportant: BriefLine[] = []

  for (const i of inbox) {
    const st = replyStateOf(i)
    if (st === 'no_reply') replyStatus.noReply++
    else if (st === 'recipient_unread') replyStatus.recipientUnread++
    else if (st === 'replied') replyStatus.replied++
    else replyStatus.reminder++

    // 返信していない重要案件（優先度A/B かつ 未返信 or 催促あり）
    if ((i.priority === 'A' || i.priority === 'B') && (st === 'no_reply' || st === 'reminder')) {
      unrepliedImportant.push({
        id: i.id,
        title: i.subject || '（件名なし）',
        sub: `${i.fromName}${i.deadline ? ` / 期限:${i.deadline}` : ''}（${i.priority}${st === 'reminder' ? '・催促' : ''}）`,
      })
    }
  }

  // ── 今日が期限（受信箱の期限 + 決断の本日中）──
  const dueToday: BriefLine[] = []
  const seenDue = new Set<string>()
  for (const i of inbox) {
    if (isDueToday(i.deadline)) {
      const title = i.subject || '（件名なし）'
      if (!seenDue.has(title)) {
        seenDue.add(title)
        dueToday.push({ id: i.id, title, sub: `${i.fromName} / 期限:${i.deadline}` })
      }
    }
  }
  for (const d of decisions) {
    if (d.timeEstimate.includes('今日') || d.timeEstimate.includes('本日')) {
      if (!seenDue.has(d.title)) {
        seenDue.add(d.title)
        dueToday.push({ id: d.id, title: d.title, sub: d.timeEstimate })
      }
    }
  }

  const totalReviewed = input
    ? input.inbox.length +
      input.scheduleCount +
      input.fileCount +
      input.metricCount +
      input.notificationCount
    : 0

  return {
    greeting: timeGreeting(now),
    generatedAt: now.toISOString(),
    windowLabel: '昨日23:00〜今日7:00',
    totalReviewed,
    totalCount,
    ceoActions,
    unrepliedImportant,
    dueToday,
    delegateActions,
    aiMonitorItems,
    replyStatus,
    monitoredCount: result.risks.length,
    readOnly: true,
    writeEnabled: false,
  }
}

// ── 整形（Project SHOGUN 標準UI）────────────────────────────────

function sourceLabel(st: ProviderSourceState): string {
  switch (st) {
    case 'loading': return '取得中'
    case 'api':
    case 'cache': return '実データ'
    case 'unconfigured': return '未設定'
    case 'error': return '取得失敗'
    default: return 'デモ'
  }
}

function formatDataStatus(s: ProviderStatusMap): string {
  return `📡 データ：受信箱=${sourceLabel(s.inbox)} / 予定=${sourceLabel(s.schedule)} / ファイル=${sourceLabel(s.file)} / 数字=${sourceLabel(s.business)} / 通知=${sourceLabel(s.notification)}`
}

export function isAllRealData(s: ProviderStatusMap): boolean {
  return (Object.values(s) as ProviderSourceState[]).every((v) => v === 'api' || v === 'cache')
}

export function formatMorningBriefing(b: MorningBriefing, dataStatus?: ProviderStatusMap): string {
  const lines: string[] = []

  lines.push(`${b.greeting}、社長。`)
  lines.push('')
  lines.push(`🌙 夜間レビュー（${b.windowLabel}）`)
  lines.push(`AIが${b.totalReviewed}件を確認しました。`)
  lines.push('')

  if (b.totalCount === 0 && b.unrepliedImportant.length === 0 && b.dueToday.length === 0) {
    lines.push('今日は対応が必要な案件はありません。')
    lines.push('')
    pushReplyStatus(lines, b)
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
    lines.push('【🔴 社長が判断すべき】')
    b.ceoActions.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(`   理由：${it.reason}`)
      lines.push(`   → ${it.suggestedAction}（${it.timeEstimate}）`)
    })
  }

  if (b.unrepliedImportant.length > 0) {
    lines.push('')
    lines.push('【✉️ 返信していない重要案件】')
    b.unrepliedImportant.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(`   ${it.sub}`)
    })
  }

  if (b.dueToday.length > 0) {
    lines.push('')
    lines.push('【⏰ 今日が期限】')
    b.dueToday.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(`   ${it.sub}`)
    })
  }

  if (b.delegateActions.length > 0) {
    lines.push('')
    lines.push('【🟡 任せる（AIが担当へ回す）】')
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
  pushReplyStatus(lines, b)
  if (dataStatus) lines.push(formatDataStatus(dataStatus))
  lines.push('残りは私が監視します。')

  return lines.join('\n')
}

function pushReplyStatus(lines: string[], b: MorningBriefing): void {
  const r = b.replyStatus
  const total = r.noReply + r.recipientUnread + r.replied + r.reminder
  if (total === 0) return
  lines.push(`【📨 返信状況（推定）】返信なし ${r.noReply} / 相手未読 ${r.recipientUnread} / 返信済み ${r.replied} / 催促あり ${r.reminder}`)
  lines.push('')
}
