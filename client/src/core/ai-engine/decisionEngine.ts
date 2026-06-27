// 優先順位決断エンジン
// 全Provider横断データから今日の優先順位TOP5を生成する
// 書き込み禁止: 読み取り専用ロジックのみ

import type { DecisionItem, CrossProviderContext, EvidenceSource, ApprovalStatus } from './aiEngineTypes'
import type {
  UnifiedInboxItem,
  UnifiedScheduleItem,
  UnifiedBusinessMetric,
  UnifiedNotification,
} from '../providers/providerTypes'

function makeEvidence(type: EvidenceSource['type'], id: string, title: string, snippet: string, source: string): EvidenceSource {
  return { type, id, title, snippet, source }
}

export function buildDecisionList(
  inbox: UnifiedInboxItem[],
  schedule: UnifiedScheduleItem[],
  metrics: UnifiedBusinessMetric[],
  notifications: UnifiedNotification[],
  crossContexts: CrossProviderContext[]
): DecisionItem[] {
  const decisions: DecisionItem[] = []

  // 1. 緊急通知（SOS・事故）
  for (const notif of notifications.filter((n) => n.urgency === 'critical')) {
    const cat = notif.category === 'accident' ? 'accident' : notif.category === 'sos' ? 'accident' : 'other'
    decisions.push({
      id: `decision-notif-${notif.id}`,
      rank: 0,
      title: notif.title,
      summary: notif.body.slice(0, 80),
      importance: 'A',
      urgency: 'critical',
      riskLevel: 'critical',
      reason: `LINE WORKSに緊急通知: ${notif.senderName ?? '不明'}よりのSOS・事故報告`,
      evidenceSources: [makeEvidence('notification', notif.id, notif.title, notif.body.slice(0, 60), notif.source)],
      suggestedAction: notif.suggestedAction ?? '即時対応してください',
      timeEstimate: '今すぐ（30分以内）',
      requiresApproval: false,
      approvalStatus: 'pending' as ApprovalStatus,
      category: cat,
      isImmediate: true,
      readOnly: true,
      writeEnabled: false,
    })
  }

  // 2. 横断コンテキスト（重要度A）
  for (const ctx of crossContexts.filter((c) => c.importance === 'A' && c.urgency !== 'low')) {
    decisions.push({
      id: `decision-ctx-${ctx.id}`,
      rank: 0,
      title: ctx.title,
      summary: ctx.summary,
      importance: ctx.importance,
      urgency: ctx.urgency,
      riskLevel: ctx.riskLevel,
      reason: ctx.reason,
      evidenceSources: ctx.evidenceSources.slice(0, 4),
      suggestedAction: ctx.suggestedAction,
      timeEstimate: ctx.urgency === 'critical' ? '今すぐ（30分以内）' : '本日中',
      requiresApproval: ctx.requiresApproval,
      approvalStatus: 'pending' as ApprovalStatus,
      category: categoryFromTheme(ctx.theme),
      isImmediate: ctx.urgency === 'critical',
      readOnly: true,
      writeEnabled: false,
    })
  }

  // 3. 受信箱 優先度A（返信・承認が必要なもの）
  for (const item of inbox.filter((i) => i.priority === 'A')) {
    const alreadyIn = decisions.some((d) => d.evidenceSources.some((e) => e.id === item.id))
    if (alreadyIn) continue
    decisions.push({
      id: `decision-inbox-${item.id}`,
      rank: 0,
      title: item.subject ?? '（件名なし）',
      summary: item.bodyPreview?.slice(0, 80) ?? '',
      importance: 'A',
      urgency: 'high',
      riskLevel: 'medium',
      reason: `${item.source}より優先度A案件: ${item.from}`,
      evidenceSources: [makeEvidence('inbox', item.id, item.subject ?? '', item.bodyPreview?.slice(0, 60) ?? '', item.source)],
      suggestedAction: item.replyDraftAvailable ? '返信下書きを確認し、社長承認後に対応してください' : '内容を確認し、方針を決定してください',
      timeEstimate: item.deadline ? `期限: ${item.deadline}` : '本日中',
      requiresApproval: item.requiresApproval ?? false,
      approvalStatus: 'pending' as ApprovalStatus,
      category: 'other',
      isImmediate: false,
      readOnly: true,
      writeEnabled: false,
    })
  }

  // 4. 経営数値の危険指標
  for (const m of metrics.filter((m) => m.riskLevel === 'critical' || m.riskLevel === 'high')) {
    const alreadyIn = decisions.some((d) => d.evidenceSources.some((e) => e.id === m.id))
    if (alreadyIn) continue
    decisions.push({
      id: `decision-metric-${m.id}`,
      rank: 0,
      title: `⚠️ ${m.metricName}: ${m.value}${m.unit}`,
      summary: m.alertReason ?? `${m.metricName}が基準値を超えています`,
      importance: 'A',
      urgency: m.riskLevel === 'critical' ? 'critical' : 'high',
      riskLevel: m.riskLevel === 'critical' ? 'critical' : 'high',
      reason: m.alertReason ?? `${m.metricName}が危険水準です`,
      evidenceSources: [makeEvidence('metric', m.id, m.metricName, `${m.value}${m.unit}`, m.source)],
      suggestedAction: m.suggestedAction ?? '数値を確認し、対応方針を決定してください',
      timeEstimate: '本日中',
      requiresApproval: true,
      approvalStatus: 'pending' as ApprovalStatus,
      category: categoryFromMetric(m.metricKey),
      isImmediate: m.riskLevel === 'critical',
      readOnly: true,
      writeEnabled: false,
    })
  }

  // 5. 今日の重要予定
  const todayDate = new Date().toISOString().slice(0, 10)
  for (const ev of schedule.filter((s) => s.startAt.startsWith(todayDate) && s.priority === 'A')) {
    const alreadyIn = decisions.some((d) => d.evidenceSources.some((e) => e.id === ev.id))
    if (alreadyIn) continue
    decisions.push({
      id: `decision-schedule-${ev.id}`,
      rank: 0,
      title: ev.title,
      summary: ev.description?.slice(0, 80) ?? ev.title,
      importance: 'A',
      urgency: ev.deadlineRisk ? 'critical' : 'high',
      riskLevel: ev.deadlineRisk ? 'high' : 'medium',
      reason: `本日の重要予定: ${ev.startAt.slice(11, 16)} ${ev.location ? `@ ${ev.location}` : ''}`,
      evidenceSources: [makeEvidence('schedule', ev.id, ev.title, ev.description?.slice(0, 60) ?? '', ev.source)],
      suggestedAction: ev.suggestedAction ?? '予定の準備と関係者への連絡を確認してください',
      timeEstimate: ev.startAt.slice(11, 16),
      requiresApproval: false,
      approvalStatus: 'pending' as ApprovalStatus,
      category: 'other',
      isImmediate: false,
      readOnly: true,
      writeEnabled: false,
    })
  }

  // ランク付け
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = decisions.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 3
    const ub = urgencyOrder[b.urgency] ?? 3
    if (ua !== ub) return ua - ub
    return a.importance.localeCompare(b.importance)
  })

  return sorted.slice(0, 7).map((d, i) => ({ ...d, rank: i + 1 }))
}

export function buildImmediateActions(decisions: DecisionItem[]): DecisionItem[] {
  return decisions
    .filter((d) => d.isImmediate || d.urgency === 'critical')
    .slice(0, 3)
}

function categoryFromTheme(theme: string): DecisionItem['category'] {
  if (theme.includes('銀行')) return 'bank'
  if (theme.includes('請求') || theme.includes('未回収')) return 'billing'
  if (theme.includes('事故') || theme.includes('SOS')) return 'accident'
  if (theme.includes('人員')) return 'personnel'
  if (theme.includes('お結び') || theme.includes('現場')) return 'field'
  return 'other'
}

function categoryFromMetric(key: string): DecisionItem['category'] {
  if (key.includes('cash') || key.includes('bank')) return 'bank'
  if (key.includes('unbilled') || key.includes('uncollected')) return 'billing'
  if (key.includes('accident')) return 'accident'
  return 'other'
}
