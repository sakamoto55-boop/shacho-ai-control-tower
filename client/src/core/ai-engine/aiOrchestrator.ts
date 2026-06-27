// AI Orchestrator — 全Providerデータを統合し、社長室の中心判断を行う
// デモモード: 全モックデータを同期的に処理
// 書き込み禁止: 外部API書き込みは一切行わない

import type { OrchestratorResult, RiskCluster } from './aiEngineTypes'
import type { UnifiedRisk } from '../providers/providerTypes'

import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { mapToGmailDerivedTask } from '../../services/gmail/gmailMapper'
import { mapGmailDerivedTaskToUnifiedInboxItem } from '../providers/inboxProvider'

import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { mapGoogleCalendarEventToUnifiedScheduleItem } from '../../services/calendar/calendarMapper'

import { mockDriveFiles } from '../../services/drive/mockDrive'
import { mapGoogleDriveFileToUnifiedFileItem } from '../../services/drive/driveMapper'

import { mockBusinessDataset } from '../../services/sheets/mockSheets'

import { mockLineWorksNotifications, mockLineWorksInboxMessages } from '../../services/lineworks/mockLineworks'
import { mapLineWorksToUnifiedNotification, mapLineWorksToUnifiedInboxItem } from '../../services/lineworks/lineworksMapper'

import { detectNotificationRisks } from '../../services/lineworks/lineworksAnalyzer'
import { detectBusinessRisks } from '../../services/sheets/sheetsAnalyzer'

import { buildCrossProviderContexts } from './crossProviderContext'
import { calculateCompanyHealth } from './companyHealthEngine'
import { buildDecisionList, buildImmediateActions } from './decisionEngine'
import { buildApprovalQueue } from './actionDraftEngine'
import { generateExecutiveBriefing } from './executiveBriefing'

export function runOrchestrator(): OrchestratorResult {
  const now = new Date().toISOString()

  // ── データ収集（全デモモック）──────────────────────────────────────

  // Inbox: Gmail + LINE WORKS
  const gmailTasks = mockGmailMessages.map(mapToGmailDerivedTask)
  const gmailInboxItems = gmailTasks.map(mapGmailDerivedTaskToUnifiedInboxItem)
  const lwInboxItems = mockLineWorksInboxMessages.map(mapLineWorksToUnifiedInboxItem)
  const inbox = [...gmailInboxItems, ...lwInboxItems]

  // Schedule: Calendar
  const schedule = mockCalendarEvents
    .filter((e) => e.status !== 'cancelled')
    .map((e) => mapGoogleCalendarEventToUnifiedScheduleItem(e, 'demo'))

  // Files: Drive
  const files = mockDriveFiles
    .filter((f) => !f.trashed)
    .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, 'デモDrive'))

  // BusinessData: Sheets
  const metrics = mockBusinessDataset.metrics

  // Notifications: LINE WORKS
  const notifications = mockLineWorksNotifications.map(mapLineWorksToUnifiedNotification)

  // ── AI Engine 処理 ────────────────────────────────────────────────

  // 1. 横断コンテキスト
  const crossContexts = buildCrossProviderContexts(inbox, schedule, files, metrics, notifications)

  // 2. 会社健康度
  const healthScore = calculateCompanyHealth(metrics, notifications, schedule)

  // 3. リスク検出
  const notifRisks: UnifiedRisk[] = detectNotificationRisks(notifications)
  const businessRisks = detectBusinessRisks(metrics).map((r): UnifiedRisk => ({
    id: `risk-biz-${r.metricId}`,
    sources: ['google-sheets'],
    riskType: 'その他',
    title: r.label,
    description: r.description ?? '',
    severity: r.severity === 'critical' ? 'critical' : r.severity === 'high' ? 'high' : r.severity === 'medium' ? 'medium' : 'low',
    detectedAt: now,
    deadline: null,
  }))
  const risks: UnifiedRisk[] = [...notifRisks, ...businessRisks]

  // 4. リスククラスター
  const riskClusters: RiskCluster[] = crossContexts
    .filter((ctx) => ctx.riskLevel !== 'none')
    .map((ctx): RiskCluster => ({
      id: `cluster-${ctx.id}`,
      theme: ctx.theme,
      title: ctx.title,
      severity: ctx.urgency === 'critical' ? 'critical' : ctx.urgency === 'high' ? 'high' : ctx.urgency === 'medium' ? 'medium' : 'low',
      risks: risks.filter((r) => ctx.evidenceSources.some((e) => r.id.includes(e.type))),
      crossContextId: ctx.id,
      readOnly: true,
      writeEnabled: false,
    }))

  // 5. 決断リスト
  const decisions = buildDecisionList(inbox, schedule, metrics, notifications, crossContexts)

  // 6. 承認キュー
  const approvalQueue = buildApprovalQueue(inbox, notifications, decisions)

  // 7. 朝ブリーフィング
  const briefing = generateExecutiveBriefing(
    inbox, schedule, metrics, notifications, crossContexts, decisions, healthScore
  )

  // 8. 今日のプラン
  const immediateActions = buildImmediateActions(decisions)
  const todayPlan = {
    id: `plan-${now.slice(0, 10)}`,
    generatedAt: now,
    immediateActions,
    decisions,
    approvalQueue,
    readOnly: true as const,
    writeEnabled: false as const,
  }

  return {
    briefing,
    todayPlan,
    healthScore,
    risks,
    riskClusters,
    approvalQueue,
    crossContexts,
    generatedAt: now,
  }
}
