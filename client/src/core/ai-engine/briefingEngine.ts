import type { UnifiedInboxItem, UnifiedRisk } from '../providers/providerTypes'
import type { BriefingSection } from './aiEngineTypes'

export const briefingEngine = {
  generateSections(inbox: UnifiedInboxItem[], risks: UnifiedRisk[]): BriefingSection[] {
    const sections: BriefingSection[] = []

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

    // アクションセクション
    const actionItems = inbox
      .filter((i) => i.deadline !== null)
      .slice(0, 3)
      .map((i) => `${i.subject} — 期限: ${i.deadline}`)

    sections.push({
      sectionType: 'action',
      title: '本日の推奨アクション',
      items: actionItems,
      alertLevel: actionItems.length > 0 ? 'info' : null,
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

  // 将来: schedule, businessMetrics なども受け取る
}
