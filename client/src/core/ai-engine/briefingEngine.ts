import type { UnifiedInboxItem, UnifiedScheduleItem, UnifiedFileItem, UnifiedRisk, UnifiedBusinessMetric, UnifiedNotification } from '../providers/providerTypes'
import type { BriefingSection } from './aiEngineTypes'

export const briefingEngine = {
  generateSections(
    inbox: UnifiedInboxItem[],
    risks: UnifiedRisk[],
    schedule: UnifiedScheduleItem[] = [],
    files: UnifiedFileItem[] = [],
    metrics: UnifiedBusinessMetric[] = [],
    notifications: UnifiedNotification[] = []
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

    // LINE WORKS通知セクション（Phase 9 追加）
    if (notifications.length > 0) {
      const urgentNotifs = notifications.filter(
        (n) => n.urgency === 'critical' || n.urgency === 'high'
      )
      const notifItems = urgentNotifs.slice(0, 5).map((n) => {
        const mark = n.urgency === 'critical' ? '🚨 ' : '⚠️ '
        return `${mark}${n.title}`
      })
      if (notifItems.length > 0) {
        sections.push({
          sectionType: 'notification',
          title: `LINE WORKS緊急通知 ${urgentNotifs.length}件`,
          items: notifItems,
          alertLevel: urgentNotifs.some((n) => n.urgency === 'critical') ? 'danger' : 'warning',
        })
      }
    }

    // 受信トレイセクション
    const priorityAItems = inbox.filter((i) => i.priority === 'A')
    sections.push({
      sectionType: 'inbox',
      title: '受信トレイ 要対応',
      items: priorityAItems.slice(0, 5).map((i) => `【${i.priority}】${i.subject}（${i.from}）`),
      alertLevel: priorityAItems.length > 0 ? 'warning' : null,
    })

    // BusinessData セクション（Phase 8 追加）
    if (metrics.length > 0) {
      const dangerMetrics = metrics.filter((m) => m.status === 'danger' || m.status === 'warning')
      const metricItems = dangerMetrics.slice(0, 5).map((m) => {
        const mark = m.status === 'danger' ? '🔴 ' : '⚠️ '
        const valStr = m.unit === '円'
          ? `¥${(m.value / 10000).toFixed(0)}万`
          : `${m.value}${m.unit}`
        return `${mark}${m.metricName}：${valStr}${m.alertReason ? ` — ${m.alertReason}` : ''}`
      })
      sections.push({
        sectionType: 'business-data' as BriefingSection['sectionType'],
        title: `経営数字アラート ${dangerMetrics.length}件`,
        items: metricItems,
        alertLevel: dangerMetrics.some((m) => m.status === 'danger') ? 'danger' : 'warning',
      })
    }

    // リスクセクション
    const criticalRisks = risks.filter((r) => r.severity === 'critical' || r.severity === 'high')
    sections.push({
      sectionType: 'risk',
      title: '検知リスク',
      items: criticalRisks.slice(0, 3).map((r) => `【${r.riskType}】${r.title}`),
      alertLevel: criticalRisks.length > 0 ? 'danger' : null,
    })

    // Drive ファイルセクション（Phase 7 追加）
    if (files.length > 0) {
      const importantFiles = files.filter((f) => f.importance === 'A' || f.riskFlag)
      const fileItems = files.slice(0, 5).map((f) => {
        const mark = f.riskFlag ? '⚠️ ' : f.importance === 'A' ? '📌 ' : ''
        return `${mark}${f.name}（${f.category}）`
      })
      sections.push({
        sectionType: 'files' as BriefingSection['sectionType'],
        title: `最近の重要ファイル ${files.length}件`,
        items: fileItems,
        alertLevel: importantFiles.length > 0 ? 'warning' : 'info',
      })
    }

    // Inbox × Schedule × File × BusinessData 横断アクションセクション
    const crossItems = generateCrossItems(inbox, schedule, files, metrics)
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

// Gmail × Calendar × Drive × BusinessData 横断で優先アクションを生成
function generateCrossItems(
  inbox: UnifiedInboxItem[],
  schedule: UnifiedScheduleItem[],
  files: UnifiedFileItem[] = [],
  metrics: UnifiedBusinessMetric[] = []
): string[] {
  const result: string[] = []

  for (const event of schedule.filter((e) => e.priority === 'A' || e.deadlineRisk)) {
    const relatedMail = inbox.find((i) => i.taskType === event.category)
    const relatedFile = files.find((f) => f.category === event.category)

    if (relatedMail && relatedFile) {
      const timeStr = event.isAllDay ? '本日' : formatEventTime(event.startAt)
      result.push(
        `${timeStr} ${event.title}は、${relatedMail.subject}と「${relatedFile.name}」が関連 → 先に資料確認`
      )
    } else if (relatedMail) {
      const timeStr = event.isAllDay ? '本日' : formatEventTime(event.startAt)
      result.push(
        `${timeStr} ${event.title}は、${relatedMail.subject}（${relatedMail.from}）と関連 → 先に資料確認`
      )
    } else if (relatedFile) {
      const timeStr = event.isAllDay ? '本日' : formatEventTime(event.startAt)
      result.push(
        `${timeStr} ${event.title}の関連資料「${relatedFile.name}」を事前確認してください`
      )
    }
  }

  // BusinessData × File 横断（未請求 + 未請求一覧ファイル）
  const unbilledMetric = metrics.find((m) => m.metricKey === 'unbilled' && m.status === 'danger')
  if (unbilledMetric) {
    const unbilledFile = files.find((f) => f.category === '請求' && f.name.includes('未請求'))
    if (unbilledFile) {
      result.push(
        `未請求${(unbilledMetric.value / 10000).toFixed(0)}万円 — 関連資料「${unbilledFile.name}」を確認してください`
      )
    }
  }

  return result.slice(0, 5)
}

function formatEventTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
