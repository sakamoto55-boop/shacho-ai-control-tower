// AI Orchestrator — 全Providerデータを統合し、社長室の中心判断を行う
// Mission 1.1: 同期mock制約を解消。Provider別の非同期実データ取得に対応。
//   - assembleOrchestratorResult(): 純粋関数（5データセット → OrchestratorResult）
//   - load*Items(): Provider別の非同期ローダー（接続時は実データ / 未接続はデモ）
//   - runOrchestrator(): デモ同期版（後方互換。既存画面が使用）
// 書き込み禁止: 外部API書き込みは一切行わない。

import type { OrchestratorResult, RiskCluster } from './aiEngineTypes'
import type {
  UnifiedRisk,
  UnifiedInboxItem,
  UnifiedScheduleItem,
  UnifiedFileItem,
  UnifiedBusinessMetric,
  UnifiedNotification,
} from '../providers/providerTypes'

import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { mapToGmailDerivedTask } from '../../services/gmail/gmailMapper'
import { mapGmailDerivedTaskToUnifiedInboxItem } from '../providers/inboxProvider'
import { fetchRawMessages } from '../../services/gmail/gmailClient'
import { googleToken } from '../../services/google/googleToken'

import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { mapGoogleCalendarEventToUnifiedScheduleItem } from '../../services/calendar/calendarMapper'
import { calendarClient } from '../../services/calendar/calendarClient'

import { mockDriveFiles } from '../../services/drive/mockDrive'
import { mapGoogleDriveFileToUnifiedFileItem } from '../../services/drive/driveMapper'
import { driveClient } from '../../services/drive/driveClient'

import { mockBusinessDataset } from '../../services/sheets/mockSheets'
import { sheetsClient } from '../../services/sheets/sheetsClient'

import { mockLineWorksNotifications, mockLineWorksInboxMessages } from '../../services/lineworks/mockLineworks'
import { mapLineWorksToUnifiedNotification, mapLineWorksToUnifiedInboxItem } from '../../services/lineworks/lineworksMapper'
import { lineworksClient } from '../../services/lineworks/lineworksClient'

import { detectNotificationRisks } from '../../services/lineworks/lineworksAnalyzer'
import { detectBusinessRisks } from '../../services/sheets/sheetsAnalyzer'

import { buildCrossProviderContexts } from './crossProviderContext'
import { calculateCompanyHealth } from './companyHealthEngine'
import { buildDecisionList, buildImmediateActions } from './decisionEngine'
import { buildApprovalQueue } from './actionDraftEngine'
import { generateExecutiveBriefing } from './executiveBriefing'

// データソース種別（実データ=api/cache、デモ=mock、未設定=unconfigured、取得失敗=error）
export type DataSource = 'mock' | 'cache' | 'api' | 'unconfigured' | 'error'

// 全Provider統合の入力データセット
export interface OrchestratorInput {
  inbox: UnifiedInboxItem[]
  schedule: UnifiedScheduleItem[]
  files: UnifiedFileItem[]
  metrics: UnifiedBusinessMetric[]
  notifications: UnifiedNotification[]
}

// ── 純粋関数: 5データセット → OrchestratorResult（同期・副作用なし）──────
export function assembleOrchestratorResult(input: OrchestratorInput): OrchestratorResult {
  const now = new Date().toISOString()
  const { inbox, schedule, files, metrics, notifications } = input

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

// ── デモ入力（mock を Unified にマッピング）─────────────────────────────
function mapGmailMessagesToInbox(messages: typeof mockGmailMessages): UnifiedInboxItem[] {
  return messages.map(mapToGmailDerivedTask).map(mapGmailDerivedTaskToUnifiedInboxItem)
}

export function getDemoInput(): OrchestratorInput {
  const gmailInboxItems = mapGmailMessagesToInbox(mockGmailMessages)
  const lwInboxItems = mockLineWorksInboxMessages.map(mapLineWorksToUnifiedInboxItem)
  return {
    inbox: [...gmailInboxItems, ...lwInboxItems],
    schedule: mockCalendarEvents
      .filter((e) => e.status !== 'cancelled')
      .map((e) => mapGoogleCalendarEventToUnifiedScheduleItem(e, 'demo')),
    files: mockDriveFiles
      .filter((f) => !f.trashed)
      .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, 'デモDrive')),
    metrics: mockBusinessDataset.metrics,
    notifications: mockLineWorksNotifications.map(mapLineWorksToUnifiedNotification),
  }
}

// ── 後方互換: 同期デモ版（既存画面が使用）────────────────────────────────
export function runOrchestrator(): OrchestratorResult {
  return assembleOrchestratorResult(getDemoInput())
}

// ── Provider別 非同期ローダー（接続時は実データ / 未接続はデモへフォールバック）──

// Inbox: Gmail（実データ対応）+ LINE WORKS受信箱
export async function loadInboxItems(): Promise<{ items: UnifiedInboxItem[]; source: DataSource }> {
  let gmailItems: UnifiedInboxItem[]
  let source: DataSource
  try {
    const messages = await fetchRawMessages() // 接続時=本番Gmail / 未接続=mock
    gmailItems = mapGmailMessagesToInbox(messages)
    source = googleToken.hasToken() ? 'api' : 'mock'
  } catch {
    gmailItems = mapGmailMessagesToInbox(mockGmailMessages)
    source = 'mock'
  }
  const lw = await lineworksClient.fetchInboxMessages()
  const lwItems = lw.data.map(mapLineWorksToUnifiedInboxItem)
  return { items: [...gmailItems, ...lwItems], source }
}

// Schedule: Google Calendar
export async function loadScheduleItems(): Promise<{ items: UnifiedScheduleItem[]; source: DataSource }> {
  const res = await calendarClient.fetchEvents()
  const items = res.events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => mapGoogleCalendarEventToUnifiedScheduleItem(e, res.source === 'api' ? 'google-calendar' : 'demo'))
  return { items, source: res.source }
}

// File: Google Drive
export async function loadFileItems(): Promise<{ items: UnifiedFileItem[]; source: DataSource }> {
  const res = await driveClient.fetchFiles()
  const items = res.files
    .filter((f) => !f.trashed)
    .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, res.source === 'api' ? 'Google Drive' : 'デモDrive'))
  return { items, source: res.source }
}

// BusinessData: Google Sheets
export async function loadMetricItems(): Promise<{ items: UnifiedBusinessMetric[]; source: DataSource }> {
  const res = await sheetsClient.fetchDataset()
  return { items: res.dataset.metrics, source: res.source }
}

// Notification: LINE WORKS
export async function loadNotificationItems(): Promise<{ items: UnifiedNotification[]; source: DataSource }> {
  const res = await lineworksClient.fetchNotifications()
  const items = res.data.map(mapLineWorksToUnifiedNotification)
  return { items, source: res.source }
}
