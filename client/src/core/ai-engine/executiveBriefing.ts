// 朝ブリーフィング生成エンジン
// 全Provider横断データから社長向け朝ブリーフィングを生成する
// 書き込み禁止: 読み取り専用ロジックのみ

import type { ExecutiveBriefing, CrossProviderContext, DecisionItem, CompanyHealthScore } from './aiEngineTypes'
import type {
  UnifiedInboxItem,
  UnifiedScheduleItem,
  UnifiedBusinessMetric,
  UnifiedNotification,
} from '../providers/providerTypes'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 11) return 'おはようございます'
  if (hour < 17) return 'こんにちは'
  return 'お疲れさまです'
}

function buildHeadline(
  crossContexts: CrossProviderContext[],
  decisions: DecisionItem[],
  notifications: UnifiedNotification[]
): { headline: string; reason: string } {
  // 緊急通知がある場合
  const criticalNotif = notifications.find((n) => n.urgency === 'critical')
  if (criticalNotif) {
    return {
      headline: `【緊急対応】${criticalNotif.title}`,
      reason: `LINE WORKSに緊急通知が届いています。即時対応が必要です。`,
    }
  }

  // 横断コンテキストの最重要
  const topCtx = crossContexts.find((c) => c.urgency === 'critical' || c.urgency === 'high')
  if (topCtx) {
    return {
      headline: `本日の最優先: ${topCtx.theme}`,
      reason: topCtx.reason,
    }
  }

  // 決断リスト最上位
  const topDecision = decisions[0]
  if (topDecision) {
    return {
      headline: topDecision.title,
      reason: topDecision.reason,
    }
  }

  return {
    headline: '本日も安全・確実な業務運営をお願いします',
    reason: '重大なリスクは検出されていません',
  }
}

function buildSummaryText(
  inbox: UnifiedInboxItem[],
  schedule: UnifiedScheduleItem[],
  metrics: UnifiedBusinessMetric[],
  notifications: UnifiedNotification[],
  health: CompanyHealthScore
): string {
  const lines: string[] = []

  const criticalNotifs = notifications.filter((n) => n.urgency === 'critical')
  if (criticalNotifs.length > 0) {
    lines.push(`🚨 LINE WORKSに緊急通知が${criticalNotifs.length}件届いています（${criticalNotifs.map((n) => n.title).join('、')}）。`)
  }

  const todaySchedules = schedule.filter((s) => {
    if (!s.startAt) return false
    return s.startAt.startsWith(new Date().toISOString().slice(0, 10))
  })
  if (todaySchedules.length > 0) {
    const first = todaySchedules[0]
    lines.push(`📅 本日${todaySchedules.length}件の予定があります（最初: ${first.title} ${first.startAt.slice(11, 16)}）。`)
  }

  const dangerMetrics = metrics.filter((m) => m.status === 'danger')
  if (dangerMetrics.length > 0) {
    lines.push(`📊 経営数字に危険指標が${dangerMetrics.length}件あります（${dangerMetrics.map((m) => m.metricName).join('、')}）。`)
  }

  const priorityAInbox = inbox.filter((i) => i.priority === 'A')
  if (priorityAInbox.length > 0) {
    lines.push(`📧 優先度Aのメール・連絡が${priorityAInbox.length}件あります（${priorityAInbox[0].subject ?? priorityAInbox[0].from}など）。`)
  }

  lines.push(`🏢 会社健康度: ${health.total}点（${health.grade}グレード）${health.topRisks.length > 0 ? ` — 要注意: ${health.topRisks[0].slice(0, 30)}` : ''}`)

  return lines.join('\n')
}

export function generateExecutiveBriefing(
  inbox: UnifiedInboxItem[],
  schedule: UnifiedScheduleItem[],
  metrics: UnifiedBusinessMetric[],
  notifications: UnifiedNotification[],
  crossContexts: CrossProviderContext[],
  decisions: DecisionItem[],
  health: CompanyHealthScore
): ExecutiveBriefing {
  const now = new Date().toISOString()
  const greeting = getGreeting()
  const { headline, reason: headlineReason } = buildHeadline(crossContexts, decisions, notifications)
  const summaryText = buildSummaryText(inbox, schedule, metrics, notifications, health)

  const todayFocusItems: string[] = []
  if (notifications.some((n) => n.urgency === 'critical')) todayFocusItems.push('🚨 緊急対応')
  if (crossContexts.some((c) => c.theme === '銀行対応')) todayFocusItems.push('🏦 銀行対応')
  if (crossContexts.some((c) => c.theme === '未請求・未回収')) todayFocusItems.push('💰 未請求・督促')
  if (crossContexts.some((c) => c.theme === '事故対応')) todayFocusItems.push('🚑 事故対応')
  if (crossContexts.some((c) => c.theme === '人員不足')) todayFocusItems.push('👥 人員確保')
  if (schedule.some((s) => s.deadlineRisk)) todayFocusItems.push('⏰ 期限注意')
  if (todayFocusItems.length === 0) todayFocusItems.push('✅ 通常業務')

  return {
    id: `briefing-${now.slice(0, 10)}`,
    generatedAt: now,
    greeting,
    headline,
    headlineReason,
    summaryText,
    todayFocusItems,
    crossContexts,
    topDecisions: decisions.slice(0, 5),
    healthScore: health,
    readOnly: true,
    writeEnabled: false,
  }
}
