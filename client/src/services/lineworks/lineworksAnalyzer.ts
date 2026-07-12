// LINE WORKS 通知リスク検知・サマリー生成

import type { UnifiedNotification, UnifiedRisk } from '../../core/providers/providerTypes'

export interface LineWorksNotificationSummary {
  criticalCount: number
  highCount: number
  accidentCount: number
  sosCount: number
  absenceCount: number
  vehicleCount: number
  delayCount: number
  requiresActionCount: number
}

export function detectNotificationRisks(notifications: UnifiedNotification[]): UnifiedRisk[] {
  const risks: UnifiedRisk[] = []
  const now = new Date().toISOString()

  for (const notif of notifications) {
    if (notif.category === 'accident') {
      risks.push({
        id: `risk-lw-${notif.id}-accident`,
        sources: ['line-works'],
        riskType: '事故',
        severity: 'critical',
        title: `事故リスク: ${notif.title}`,
        description: notif.body.slice(0, 100),
        detectedAt: now,
        deadline: null,
      })
    } else if (notif.category === 'sos') {
      risks.push({
        id: `risk-lw-${notif.id}-sos`,
        sources: ['line-works'],
        riskType: '事故',
        severity: 'critical',
        title: `SOS緊急連絡: ${notif.senderName ?? '不明'}`,
        description: notif.body.slice(0, 100),
        detectedAt: now,
        deadline: null,
      })
    } else if (notif.category === 'vehicle' && notif.riskFlag) {
      risks.push({
        id: `risk-lw-${notif.id}-vehicle`,
        sources: ['line-works'],
        riskType: 'その他',
        severity: 'high',
        title: `車両トラブルリスク: ${notif.senderName ?? '不明'}`,
        description: notif.body.slice(0, 100),
        detectedAt: now,
        deadline: null,
      })
    } else if (notif.category === 'absence') {
      risks.push({
        id: `risk-lw-${notif.id}-absence`,
        sources: ['line-works'],
        riskType: '人員不足',
        severity: 'high',
        title: `欠勤による人員不足: ${notif.senderName ?? '不明'}`,
        description: notif.body.slice(0, 100),
        detectedAt: now,
        deadline: null,
      })
    }
  }

  return risks
}

export function createNotificationSummary(
  notifications: UnifiedNotification[]
): LineWorksNotificationSummary {
  return {
    criticalCount: notifications.filter((n) => n.urgency === 'critical').length,
    highCount: notifications.filter((n) => n.urgency === 'high').length,
    accidentCount: notifications.filter((n) => n.category === 'accident').length,
    sosCount: notifications.filter((n) => n.category === 'sos').length,
    absenceCount: notifications.filter((n) => n.category === 'absence').length,
    vehicleCount: notifications.filter((n) => n.category === 'vehicle').length,
    delayCount: notifications.filter((n) => n.category === 'delay').length,
    requiresActionCount: notifications.filter((n) => n.requiresAction).length,
  }
}
