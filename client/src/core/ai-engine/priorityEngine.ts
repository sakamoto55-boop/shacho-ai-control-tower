import type { UnifiedInboxItem, UnifiedScheduleItem, UnifiedRisk } from '../providers/providerTypes'
import type { PriorityScore } from './aiEngineTypes'

function scoreInboxItemInternal(item: UnifiedInboxItem): PriorityScore {
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

export const priorityEngine = {
  scoreInboxItem(item: UnifiedInboxItem): PriorityScore {
    return scoreInboxItemInternal(item)
  },

  rankItems(items: UnifiedInboxItem[]): UnifiedInboxItem[] {
    const scored = items.map((item) => ({
      item,
      score: scoreInboxItemInternal(item),
    }))
    scored.sort((a, b) => b.score.finalScore - a.score.finalScore)
    return scored.map((s) => s.item)
  },

  getCrossServiceTopItems(
    inbox: UnifiedInboxItem[],
    _schedule: UnifiedScheduleItem[],
    risks: UnifiedRisk[]
  ): string[] {
    const topActions: string[] = []

    // 最上位のインボックスアイテム
    const rankedInbox = this.rankItems(inbox)
    for (const item of rankedInbox.slice(0, 3)) {
      topActions.push(`【${item.priority}】${item.subject}（${item.from}）`)
    }

    // 重大リスク
    for (const risk of risks.filter((r) => r.severity === 'critical' || r.severity === 'high').slice(0, 2)) {
      topActions.push(`【リスク】${risk.title}`)
    }

    return topActions
  },
}
