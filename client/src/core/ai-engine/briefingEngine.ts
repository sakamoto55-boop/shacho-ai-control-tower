import type { UnifiedInboxItem, UnifiedScheduleItem, UnifiedRisk } from '../providers/providerTypes'
import type { BriefingSection } from './aiEngineTypes'

export const briefingEngine = {
  generateSections(
    inbox: UnifiedInboxItem[],
    risks: UnifiedRisk[],
    schedule: UnifiedScheduleItem[] = []
  ): BriefingSection[] {
    const sections: BriefingSection[] = []

    // スケジュールセクション（Phase 6 追加）
    if (schedule.length > 0) {
      const importantEvents = schedule.filter((e) => e.priority === 'A' || e.deadlineRisk)
      const eventItems = schedule.slice(0, 5).map((e) => {
        const timeStr = e.isAllDay ? '終日' : formatEventTime(e.startAt)
        const mark = e.deadlineRisk ? '⚠️ ' : e.priority === 'A' ? '🔴 ' : ''
        return `${mark}${timeStr} ${e.title}（${e.category}）`
      })
      sections.push({
        sectionType: 'schedule',
        title: `本日の予定 ${schedule.length}件`,
        items: eventItems,
        alertLevel: importantEvents.length > 0 ? 'warning' : 'info',
      })
    }

    // 受信トレイセクション
    const priorityAItems = inbox.filter((i) => i.priority === 'A')
    sections.push({
      sectionType: 'inbox',
      title: '受信トレイ 要対応',
      items: priorityAItems.slice(0, 5).map((i) => `【${i.priority}】${i.subject}（${i.from}）`),
      alertLevel: priorityAItems.length > 0 ? 'warning' : null,
    })

    // リスクセクション
    const criticalRisks = risks.filter((r) => r.severity === 'critical' || r.severity === 'high')
    sections.push({
      sectionType: 'risk',
      title: '検知リスク',
      items: criticalRisks.slice(0, 3).map((r) => `【${r.riskType}】${r.title}`),
      alertLevel: criticalRisks.length > 0 ? 'danger' : null,
    })

    // Inbox × Schedule 横断アクションセクション
    const crossItems = generateCrossItems(inbox, schedule)
    const deadlineItems = inbox
      .filter((i) => i.deadline !== null)
      .slice(0, 3)
      .map((i) => `${i.subject} — 期限: ${i.deadline}`)

    const allActionItems = [...crossItems, ...deadlineItems].slice(0, 5)

    sections.push({
      sectionType: 'action',
      title: '本日の推奨アクション',
      items: allActionItems,
      alertLevel: allActionItems.length > 0 ? 'info' : null,
    })

    return sections
  },

  generateGreeting(date: Date): string {
    const hour = date.getHours()
    if (hour < 10) return 'おはようございます。今日も一日よろしくお願いします。'
    if (hour < 14) return 'お昼のブリーフィングです。午後もよろしくお願いします。'
    if (hour < 18) return '午後のブリーフィングです。今日の残りもしっかりと。'
    return 'お疲れ様です。本日の最終確認をどうぞ。'
  },
}

// Gmail × Calendar 横断で優先アクションを生成
function generateCrossItems(inbox: UnifiedInboxItem[], schedule: UnifiedScheduleItem[]): string[] {
  const result: string[] = []

  for (const event of schedule.filter((e) => e.priority === 'A' || e.deadlineRisk)) {
    const relatedMail = inbox.find((i) => i.taskType === event.category)
    if (relatedMail) {
      const timeStr = event.isAllDay ? '本日' : formatEventTime(event.startAt)
      result.push(
        `${timeStr} ${event.title}は、${relatedMail.subject}（${relatedMail.from}）と関連 → 先に資料確認`
      )
    }
  }

  return result.slice(0, 3)
}

function formatEventTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
