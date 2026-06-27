import type { UnifiedInboxItem, UnifiedScheduleItem, UnifiedFileItem, UnifiedRisk } from '../providers/providerTypes'
import type { PriorityScore } from './aiEngineTypes'

function scoreInboxItemInternal(
  item: UnifiedInboxItem,
  schedule: UnifiedScheduleItem[] = [],
  files: UnifiedFileItem[] = []
): PriorityScore {
  let baseScore = 50
  const modifiers: { reason: string; delta: number }[] = []

  // 優先度による加算
  if (item.priority === 'A') {
    modifiers.push({ reason: '優先度A', delta: 30 })
  } else if (item.priority === 'B') {
    modifiers.push({ reason: '優先度B', delta: 10 })
  } else {
    modifiers.push({ reason: '優先度C', delta: -10 })
  }

  // 期限による加算
  if (item.deadline) {
    modifiers.push({ reason: '期限あり', delta: 15 })
  }

  // タスクタイプによる加算
  if (item.taskType === '銀行' || item.taskType === '事故') {
    modifiers.push({ reason: `重要タイプ（${item.taskType}）`, delta: 10 })
  } else if (item.taskType === '請求' || item.taskType === '契約') {
    modifiers.push({ reason: `要注意タイプ（${item.taskType}）`, delta: 5 })
  }

  // 返信下書きがある場合
  if (item.replyDraftAvailable) {
    modifiers.push({ reason: '返信下書きあり', delta: 5 })
  }

  // ── 横断スコアリング（Inbox × Schedule）────────────────────────
  if (schedule.length > 0) {
    const relatedEvent = findRelatedScheduleEvent(item, schedule)
    if (relatedEvent) {
      modifiers.push({ reason: `本日予定と関連（${relatedEvent.category}）`, delta: 20 })
      if (relatedEvent.priority === 'A') {
        modifiers.push({ reason: '関連予定が最重要', delta: 10 })
      }
    }
  }

  // ── 横断スコアリング（Inbox × File）─────────────────────────
  // GmailタスクタイプとDriveファイルカテゴリが一致する場合は優先度を上げる
  if (files.length > 0) {
    const relatedFile = files.find(
      (f) => f.category === item.taskType || f.relatedCompany === item.from
    )
    if (relatedFile) {
      modifiers.push({ reason: `関連Drive資料あり（${relatedFile.category}）`, delta: 15 })
      if (relatedFile.riskFlag) {
        modifiers.push({ reason: '関連資料にリスクフラグ', delta: 10 })
      }
    }
  }

  const totalDelta = modifiers.reduce((sum, m) => sum + m.delta, 0)
  const finalScore = Math.min(100, Math.max(0, baseScore + totalDelta))

  return {
    itemId: item.id,
    source: item.source,
    baseScore,
    modifiers,
    finalScore,
    rank: 0, // rankItems() で設定する
  }
}

// Inbox アイテムと関連するスケジュールイベントを探す
function findRelatedScheduleEvent(item: UnifiedInboxItem, schedule: UnifiedScheduleItem[]): UnifiedScheduleItem | null {
  const inboxKeywords = [
    item.taskType,
    ...item.subject.split(/[　\s]+/).filter((w) => w.length >= 2),
  ].filter(Boolean)

  for (const event of schedule) {
    // カテゴリが一致する（例：GmailTaskType '銀行' と Schedule category '銀行'）
    if (item.taskType === event.category) return event

    // タイトルにキーワードが含まれる
    const eventText = `${event.title} ${event.category}`.toLowerCase()
    if (inboxKeywords.some((k) => k && eventText.includes(k.toLowerCase()))) {
      return event
    }
  }
  return null
}

export const priorityEngine = {
  scoreInboxItem(
    item: UnifiedInboxItem,
    schedule: UnifiedScheduleItem[] = [],
    files: UnifiedFileItem[] = []
  ): PriorityScore {
    return scoreInboxItemInternal(item, schedule, files)
  },

  rankItems(
    items: UnifiedInboxItem[],
    schedule: UnifiedScheduleItem[] = [],
    files: UnifiedFileItem[] = []
  ): UnifiedInboxItem[] {
    const scored = items.map((item) => ({
      item,
      score: scoreInboxItemInternal(item, schedule, files),
    }))
    scored.sort((a, b) => b.score.finalScore - a.score.finalScore)
    return scored.map((s) => s.item)
  },

  // Schedule Provider のスコアリング
  scoreScheduleItem(event: UnifiedScheduleItem, inbox: UnifiedInboxItem[] = []): number {
    let score = 50
    if (event.priority === 'A') score += 30
    else if (event.priority === 'B') score += 10
    else score -= 10

    if (event.deadlineRisk) score += 20
    if (['銀行', '行政', '監査'].includes(event.category)) score += 15
    if (['現場', '請求', '支払'].includes(event.category)) score += 5

    // Inboxとの関連
    const related = inbox.some(
      (item) => item.taskType === event.category
    )
    if (related) score += 15

    return Math.min(100, Math.max(0, score))
  },

  // Inbox + Schedule + File 横断 TOP アイテム生成
  getCrossServiceTopItems(
    inbox: UnifiedInboxItem[],
    schedule: UnifiedScheduleItem[],
    risks: UnifiedRisk[],
    files: UnifiedFileItem[] = []
  ): string[] {
    const topActions: string[] = []

    // スケジュールの重要予定（最大2件）
    const importantEvents = schedule
      .filter((e) => e.priority === 'A' || e.deadlineRisk)
      .slice(0, 2)
    for (const event of importantEvents) {
      const timeStr = event.isAllDay ? '本日' : formatEventTime(event.startAt)
      topActions.push(`【予定】${timeStr} ${event.title}（${event.category}）`)
    }

    // Inbox + Schedule + File 横断スコアで上位インボックスアイテム
    const rankedInbox = this.rankItems(inbox, schedule, files)
    for (const item of rankedInbox.slice(0, 3)) {
      topActions.push(`【${item.priority}】${item.subject}（${item.from}）`)
    }

    // 重大リスクフラグのあるDriveファイル（最大1件）
    const riskFile = files.find((f) => f.riskFlag && f.importance === 'A')
    if (riskFile) {
      topActions.push(`【資料】${riskFile.name}（${riskFile.category}）要確認`)
    }

    // 重大リスク
    for (const risk of risks.filter((r) => r.severity === 'critical' || r.severity === 'high').slice(0, 2)) {
      topActions.push(`【リスク】${risk.title}`)
    }

    return topActions
  },
}

function formatEventTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
