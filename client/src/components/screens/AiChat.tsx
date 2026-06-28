import { useState, useRef, useEffect, useMemo } from 'react'
import type { AiMode, ChatMessage } from '../../types'
import type { Screen } from '../../types'
import { aiModes, initialChatMessages, mockAiResponses } from '../../data/mockData'
import DemoBanner from '../DemoBanner'
import {
  assembleOrchestratorResult,
  getDemoInput,
  loadInboxItems,
  loadScheduleItems,
  loadFileItems,
  loadMetricItems,
  loadNotificationItems,
  type OrchestratorInput,
} from '../../core/ai-engine/aiOrchestrator'
import type { OrchestratorResult } from '../../core/ai-engine/aiEngineTypes'
import {
  buildMorningBriefing,
  formatMorningBriefing,
  type ProviderStatusMap,
} from '../../core/ai-engine/morningBriefingEngine'
import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { mapToCalendarDerivedEvent } from '../../services/calendar/calendarMapper'
import { createCalendarSummary } from '../../services/calendar/calendarAnalyzer'
import { mockDriveFiles } from '../../services/drive/mockDrive'
import { mapGoogleDriveFileToUnifiedFileItem } from '../../services/drive/driveMapper'
import { createDriveSummary } from '../../services/drive/driveAnalyzer'
import { searchDriveFiles } from '../../services/drive/driveSearch'
import { mockBusinessDataset } from '../../services/sheets/mockSheets'
import { createBusinessSummary, detectBusinessRisks } from '../../services/sheets/sheetsAnalyzer'
import { mockLineWorksNotifications, mockLineWorksInboxMessages } from '../../services/lineworks/mockLineworks'
import { mapLineWorksToUnifiedNotification } from '../../services/lineworks/lineworksMapper'
import { createNotificationSummary } from '../../services/lineworks/lineworksAnalyzer'

interface Props {
  onVoice: () => void
  onNavigate: (screen: Screen) => void
}

const INTEGRATED_SHORTCUTS = [
  '今日30分でやることは？',
  '会社で今一番危ないことは？',
  'メール・予定・資料・数字・社内連絡をまとめて',
  '社長承認が必要なものは？',
  '今日の優先順位を理由付きで出して',
  '銀行対応だけまとめて',
  '未請求対応だけまとめて',
  '事故対応だけまとめて',
]

function getIntegratedShortcutResponse(query: string, result: OrchestratorResult): string | null {
  if (query.includes('30分') || query.includes('今すぐやること')) {
    const actions = result.todayPlan.immediateActions
    if (actions.length === 0) return '今すぐ対応が必要なアクションは検出されていません。'
    const lines = actions.map((a, i) =>
      `${i + 1}. 【${a.urgency === 'critical' ? '緊急' : '重要'}】${a.title}\n   → ${a.suggestedAction}（目安：${a.timeEstimate}）`
    ).join('\n\n')
    return `今日30分以内にやること ${actions.length}件です。\n\n${lines}\n\n全Provider横断分析（Phase 10 AI Engine） · 読み取り専用 · 外部実行なし`
  }

  if (query.includes('一番危ない') || (query.includes('危') && query.includes('こと'))) {
    const topRisk = result.risks.find((r) => r.severity === 'critical') ?? result.risks[0]
    if (!topRisk) return '現時点で重大なリスクは検出されていません。'
    const health = result.healthScore
    return `会社の最大リスク: 【${topRisk.severity}】${topRisk.title}\n\n${topRisk.description}\n\n会社健康度: ${health.total}点（グレード${health.grade}）\n要注意: ${health.topRisks.slice(0, 2).join('、') || 'なし'}\n\n全Provider横断リスク分析（Phase 10 AI Engine） · 読み取り専用`
  }

  if (query.includes('まとめて') && (query.includes('メール') || query.includes('予定') || query.includes('資料'))) {
    const b = result.briefing
    return `${b.greeting}、社長。\n\n${b.headline}\n\n${b.summaryText}\n\n本日フォーカス: ${b.todayFocusItems.join(' / ')}\n\n全Provider統合ブリーフィング（Phase 10 AI Engine） · 読み取り専用 · 外部実行なし`
  }

  if (query.includes('承認') && query.includes('必要')) {
    const queue = result.approvalQueue
    if (queue.length === 0) return '現時点で社長承認が必要なアクションはありません。'
    const lines = queue.map((a, i) =>
      `${i + 1}. 【${a.actionType}】${a.title}\n   対象：${a.targetName}\n   ⚠️ 外部への送信は行いません`
    ).join('\n\n')
    return `社長承認待ちアクション ${queue.length}件です。\n\n${lines}\n\n⚠️ 承認キューはUIと型のみです。外部実行はPhase 11以降。\n全Provider横断（Phase 10 AI Engine） · 外部送信禁止`
  }

  if (query.includes('優先順位') && query.includes('理由')) {
    const decisions = result.todayPlan.decisions.slice(0, 5)
    if (decisions.length === 0) return '優先判断対象が見つかりません。'
    const lines = decisions.map((d) =>
      `${d.rank}位: 【${d.importance}】${d.title}\n   理由: ${d.reason}\n   → ${d.suggestedAction}（${d.timeEstimate}）`
    ).join('\n\n')
    return `今日の優先順位 TOP${decisions.length}（理由付き）。\n\n${lines}\n\n全Provider横断分析（Phase 10 AI Engine） · 読み取り専用`
  }

  if (query.includes('銀行') && query.includes('まとめ')) {
    const bankCtx = result.crossContexts.find((c) => c.theme === '銀行対応')
    if (!bankCtx) return '現時点で銀行対応の横断コンテキストは検出されていません。'
    return `銀行対応サマリー\n\n${bankCtx.title}\n${bankCtx.summary}\n\n推奨アクション: ${bankCtx.suggestedAction}\n\n証拠ソース: ${bankCtx.evidenceSources.map((e) => e.title).join('、')}\n\n全Provider横断（Phase 10 AI Engine） · 読み取り専用`
  }

  if (query.includes('未請求') && query.includes('まとめ')) {
    const unbilledCtx = result.crossContexts.find((c) => c.theme === '未請求・未回収')
    if (!unbilledCtx) return '現時点で未請求・未回収の横断コンテキストは検出されていません。'
    return `未請求・未回収サマリー\n\n${unbilledCtx.title}\n${unbilledCtx.summary}\n\n推奨アクション: ${unbilledCtx.suggestedAction}\n\n全Provider横断（Phase 10 AI Engine） · 読み取り専用`
  }

  if (query.includes('事故') && query.includes('まとめ')) {
    const accidentCtx = result.crossContexts.find((c) => c.theme === '事故対応')
    if (!accidentCtx) return '現時点で事故対応の横断コンテキストは検出されていません。'
    return `事故対応サマリー\n\n${accidentCtx.title}\n${accidentCtx.summary}\n\n推奨アクション: ${accidentCtx.suggestedAction}\n\n全Provider横断（Phase 10 AI Engine） · 読み取り専用`
  }

  return null
}

const GMAIL_SHORTCUTS = [
  'Gmailの要対応をまとめて',
  '返信が必要なメールを優先順にして',
  '銀行からのメールだけ見せて',
  '今日中に対応が必要なメールは？',
  '返信文だけ作って',
]

const CALENDAR_SHORTCUTS = [
  '今日の予定をまとめて',
  '銀行関係の予定だけ見せて',
  '今日の移動が必要な予定は？',
  '期限がある予定はどれ？',
  '予定とGmailを合わせて優先順位を出して',
]

// Calendar ショートカット回答（Schedule Provider 参照）
function getCalendarShortcutResponse(input: string): string | null {
  const calEvents = mockCalendarEvents.filter((e) => e.status !== 'cancelled')
  const derived = calEvents.map((e) => mapToCalendarDerivedEvent(e, 'demo'))
  const summary = createCalendarSummary(calEvents)

  if (input.includes('今日の予定をまとめて') || input.includes('予定をまとめて')) {
    const lines = derived.map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `・${timeStr} 【${e.importance}】${e.title}（${e.category}）`
    }).join('\n')
    return `本日の予定 ${summary.totalCount}件です。\n\n${lines}\n\n重要予定${summary.importanceACount}件、移動が必要な予定${summary.travelRequiredCount}件あります。\n\nデータ元：デモCalendar · 読み取り専用 · 予定変更なし`
  }

  if (input.includes('銀行関係') || input.includes('銀行の予定')) {
    const bank = derived.filter((e) => e.category === '銀行')
    if (bank.length === 0) return '本日は銀行関係の予定はありません。'
    const lines = bank.map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `・${timeStr} ${e.title}\n  ${e.suggestedAction ?? ''}`
    }).join('\n')
    return `銀行関係の予定 ${bank.length}件です。\n\n${lines}\n\n事前に財務資料をご確認ください。`
  }

  if (input.includes('移動') && input.includes('予定')) {
    const travel = derived.filter((e) => e.location && !e.location.includes('会議室'))
    if (travel.length === 0) return '本日は移動が必要な予定はありません。'
    const lines = travel.map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `・${timeStr} ${e.title}\n  場所：${e.location}`
    }).join('\n')
    return `移動が必要な予定 ${travel.length}件です。\n\n${lines}\n\n余裕をもって出発してください。`
  }

  if (input.includes('期限') && input.includes('予定')) {
    const deadlines = derived.filter((e) => e.deadlineRisk)
    if (deadlines.length === 0) return '本日は期限のある予定はありません。'
    const lines = deadlines.map((e) => `・${e.title}（${e.category}）\n  ${e.suggestedAction ?? '本日中に対応してください'}`).join('\n')
    return `期限のある予定 ${deadlines.length}件です。\n\n${lines}`
  }

  if (input.includes('予定とGmail') || input.includes('優先順位')) {
    const importantEvents = derived.filter((e) => e.importance === 'A' || e.deadlineRisk)
    const lines = importantEvents.slice(0, 3).map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `1位：${timeStr} ${e.title} — ${e.suggestedAction ?? e.category}`
    }).join('\n')
    return `Gmail × Calendar 横断優先順位です。\n\n${lines}\n\n※Gmailの銀行・行政メールと同日の予定は優先度を上げています。\nSchedule Provider + Inbox Provider 横断分析（Phase 6）`
  }

  return null
}

const DRIVE_SHORTCUTS = [
  '銀行資料を探して',
  '契約書を探して',
  '未請求一覧はどこ？',
  '監査資料を探して',
  '事故報告書を探して',
]

// Drive ショートカット回答（File Provider 参照）
function getDriveShortcutResponse(input: string): string | null {
  const allFiles = mockDriveFiles
    .filter((f) => !f.trashed)
    .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, 'デモDrive'))
  const summary = createDriveSummary(mockDriveFiles.filter((f) => !f.trashed))

  // 汎用キーワード検索
  const keywords = ['銀行', '契約', '未請求', '請求', '監査', '事故', '資金', '見積', '車両', '福祉']
  const matchedKeyword = keywords.find((k) => input.includes(k))

  if (matchedKeyword) {
    const results = searchDriveFiles(matchedKeyword, allFiles)
    if (results.length === 0) return `「${matchedKeyword}」に関連するファイルは見つかりませんでした。`
    const lines = results.slice(0, 5).map((r) => {
      const modified = (() => {
        try { return new Date(r.item.modifiedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) } catch { return '' }
      })()
      return `・[${r.item.fileType}] ${r.item.name}（${r.item.category} / 更新:${modified}）`
    }).join('\n')
    return `「${matchedKeyword}」関連ファイル ${results.length}件見つかりました。\n\n${lines}\n\nデータ元：デモDrive · 読み取り専用 · ファイル変更なし`
  }

  if (input.includes('ファイル') || input.includes('資料') || input.includes('書類')) {
    const lines = allFiles.slice(0, 5).map((f) => `・[${f.fileType}] ${f.name}（${f.category}）`).join('\n')
    return `最近の重要ファイル ${summary.totalCount}件です。\n\n${lines}\n\n銀行:${summary.bankCount}件 / 契約:${summary.contractCount}件 / 請求:${summary.invoiceCount}件 / 監査:${summary.auditCount}件\n\nデータ元：デモDrive · 読み取り専用`
  }

  if (input.includes('今日の予定') && input.includes('関係する資料')) {
    const bankFiles = allFiles.filter((f) => f.category === '銀行')
    if (bankFiles.length > 0) {
      return `今日の銀行打合せに関連する資料を見つけました。\n\n${bankFiles.map((f) => `・${f.name}`).join('\n')}\n\n事前に内容をご確認ください。\n\nInbox × Schedule × File 横断分析（Phase 7）`
    }
    return '今日の予定に関連する資料は見つかりませんでした。'
  }

  return null
}

const SHEETS_SHORTCUTS = [
  '経営数字をまとめて',
  '現金残高はいくら？',
  '未請求・未回収を教えて',
  '粗利率は何%？',
  '資金繰りリスクはある？',
]

// Sheets ショートカット回答（BusinessData Provider 参照）
function getSheetsShortcutResponse(input: string): string | null {
  const summary = createBusinessSummary(mockBusinessDataset)
  const risks = detectBusinessRisks(mockBusinessDataset.metrics)

  if (input.includes('経営数字をまとめて') || input.includes('経営数字')) {
    const dangerCount = mockBusinessDataset.metrics.filter((m) => m.status === 'danger').length
    const warningCount = mockBusinessDataset.metrics.filter((m) => m.status === 'warning').length
    const cashStr = summary.cashBalance !== null ? `¥${((summary.cashBalance) / 10000).toFixed(0)}万` : '—'
    const grossStr = summary.grossProfitRate !== null ? `${summary.grossProfitRate}%` : '—'
    const unbilledStr = summary.unbilledAmount !== null ? `¥${((summary.unbilledAmount) / 10000).toFixed(0)}万` : '—'
    const uncollectedStr = summary.uncollectedAmount !== null ? `¥${((summary.uncollectedAmount) / 10000).toFixed(0)}万` : '—'
    return `経営数字サマリーです（Phase 8）。\n\n現金残高：${cashStr}\n今月粗利率：${grossStr}\n未請求：${unbilledStr}\n未回収：${uncollectedStr}\n\n要注意：${dangerCount}件、警告：${warningCount}件\n\nデータ元：デモSheets · 読み取り専用 · セル更新なし`
  }

  if (input.includes('現金残高')) {
    const cashStr = summary.cashBalance !== null ? `¥${((summary.cashBalance) / 10000).toFixed(0)}万` : '—'
    const cashMetric = mockBusinessDataset.metrics.find((m) => m.metricKey === 'cash_balance')
    const statusStr = cashMetric?.status === 'danger' ? '🔴 危険水準' : cashMetric?.status === 'warning' ? '🟡 注意水準' : '🟢 正常'
    return `現金残高：${cashStr}（${statusStr}）\n\n${cashMetric?.alertReason ?? '特段のアラートはありません。'}\n\nデータ元：デモSheets · 読み取り専用`
  }

  if (input.includes('未請求') || input.includes('未回収')) {
    const unbilledStr = summary.unbilledAmount !== null ? `¥${((summary.unbilledAmount) / 10000).toFixed(0)}万` : '—'
    const uncollectedStr = summary.uncollectedAmount !== null ? `¥${((summary.uncollectedAmount) / 10000).toFixed(0)}万` : '—'
    return `未請求：${unbilledStr}\n未回収：${uncollectedStr}\n\n速やかに請求書を発行し、入金確認を行ってください。\n\nデータ元：デモSheets · 読み取り専用 · セル更新なし`
  }

  if (input.includes('粗利率')) {
    const grossStr = summary.grossProfitRate !== null ? `${summary.grossProfitRate}%` : '—'
    const grossMetric = mockBusinessDataset.metrics.find((m) => m.metricKey === 'gross_profit_rate')
    const statusStr = grossMetric?.status === 'danger' ? '🔴 危険水準' : grossMetric?.status === 'warning' ? '🟡 注意水準' : '🟢 正常'
    return `今月粗利率：${grossStr}（${statusStr}）\n\n${grossMetric?.alertReason ?? '特段のアラートはありません。'}\n\nデータ元：デモSheets · 読み取り専用`
  }

  if (input.includes('資金繰りリスク') || input.includes('リスク')) {
    if (risks.length === 0) return '現時点で経営上の重大リスクは検出されていません。\n\nデータ元：デモSheets · 読み取り専用'
    const lines = risks.slice(0, 4).map((r) => {
      const icon = r.severity === 'critical' ? '🔴' : r.severity === 'high' ? '🟠' : r.severity === 'medium' ? '🟡' : '🟢'
      return `${icon} ${r.riskType}：${r.description}`
    }).join('\n')
    return `経営リスク ${risks.length}件を検出しました。\n\n${lines}\n\nデータ元：デモSheets · 読み取り専用 · 自動対応なし`
  }

  return null
}

const LINEWORKS_SHORTCUTS = [
  'LINE WORKSの通知を要約して',
  '今日のSOS・緊急連絡は？',
  '事故・トラブル報告を教えて',
  '欠勤・遅延情報をまとめて',
  'LINE WORKSの優先度A案件は？',
  '現場からの報告を整理して',
]

// LINE WORKS ショートカット回答（Notification Provider 参照）
function getLineWorksShortcutResponse(input: string): string | null {
  const notifications = mockLineWorksNotifications.map(mapLineWorksToUnifiedNotification)
  const summary = createNotificationSummary(notifications)
  const inboxItems = mockLineWorksInboxMessages

  if (input.includes('LINE WORKSの通知を要約') || input.includes('通知を要約')) {
    const lines = notifications.slice(0, 5).map((n) => {
      const mark = n.urgency === 'critical' ? '🚨' : '⚠️'
      return `・${mark}【${n.category}】${n.senderName ?? '不明'}：${n.body.slice(0, 40)}…`
    }).join('\n')
    return `LINE WORKS通知 ${notifications.length}件です。\n\n${lines}\n\n緊急${summary.criticalCount}件、重要${summary.highCount}件。\nデータ元：デモLINE WORKS · 読み取り専用 · 送信・既読化なし`
  }

  if (input.includes('SOS') || input.includes('緊急連絡')) {
    const sos = notifications.filter((n) => n.category === 'sos' || n.urgency === 'critical')
    if (sos.length === 0) return '本日はSOS・緊急連絡はありません。'
    const lines = sos.map((n) => `・🚨 ${n.senderName ?? '不明'}（${n.senderDepartment ?? '部署不明'}）\n  ${n.body.slice(0, 60)}…\n  → ${n.suggestedAction ?? '早急に確認してください'}`).join('\n\n')
    return `本日のSOS・緊急連絡 ${sos.length}件です。\n\n${lines}\n\n⚠️ 送信・既読化は禁止です。LINE WORKSで直接対応してください。`
  }

  if (input.includes('事故') || input.includes('トラブル')) {
    const accidents = notifications.filter((n) => n.category === 'accident' || n.category === 'vehicle')
    if (accidents.length === 0) return '本日は事故・トラブル報告はありません。'
    const lines = accidents.map((n) => `・【${n.category}】${n.senderName ?? '不明'}：${n.body.slice(0, 60)}…\n  → ${n.suggestedAction ?? '確認が必要です'}`).join('\n\n')
    return `事故・トラブル報告 ${accidents.length}件です。\n\n${lines}\n\nデータ元：デモLINE WORKS · 読み取り専用`
  }

  if (input.includes('欠勤') || input.includes('遅延')) {
    const absences = notifications.filter((n) => n.category === 'absence' || n.category === 'delay')
    if (absences.length === 0) return '本日は欠勤・遅延の報告はありません。'
    const lines = absences.map((n) => `・【${n.category}】${n.senderName ?? '不明'}：${n.body.slice(0, 60)}…\n  → ${n.suggestedAction ?? '対応が必要です'}`).join('\n\n')
    return `欠勤・遅延情報 ${absences.length}件です。\n\n${lines}`
  }

  if (input.includes('LINE WORKSの優先度A') || input.includes('優先度A案件')) {
    const priorityA = inboxItems.filter((m) => m.priority === 'A')
    if (priorityA.length === 0) return '優先度Aの案件はありません。'
    const lines = priorityA.map((m) => `・${m.subject}\n  送信者：${m.senderName} · 期限：${m.deadline ?? '未設定'}`).join('\n')
    return `LINE WORKS 優先度A案件 ${priorityA.length}件です。\n\n${lines}\n\n⚠️ 返信・既読化は禁止です。社長が直接対応してください。`
  }

  if (input.includes('現場') && input.includes('報告')) {
    const field = notifications.filter((n) => n.category === 'delay' || n.category === 'vehicle' || n.category === 'accident')
    if (field.length === 0) return '本日の現場からの報告はありません。'
    const lines = field.map((n) => `・【${n.category}】${n.senderName ?? '不明'}：${n.body.slice(0, 60)}…`).join('\n')
    return `現場からの報告 ${field.length}件です。\n\n${lines}\n\nデータ元：デモLINE WORKS · 読み取り専用 · 送信なし`
  }

  return null
}

function getMockResponse(mode: AiMode, input: string, orchestratorData?: OrchestratorResult, dataStatus?: ProviderStatusMap): string {
  // Project SHOGUN 朝ブリーフィングを最優先（全Provider横断・3分類・実データ対応）
  if (orchestratorData) {
    if (
      input.includes('ブリーフィング') ||
      input.includes('今朝') ||
      input.includes('おはよう') ||
      input.includes('今日は何') ||
      input.includes('今日のまとめ') ||
      input.includes('今日はこれだけ') ||
      input.includes('今日やること') ||
      input.includes('今日の予定をまとめて全部')
    ) {
      return formatMorningBriefing(buildMorningBriefing(orchestratorData), dataStatus)
    }
  }

  // 統合AI ショートカット回答を最優先（Phase 10）
  if (orchestratorData) {
    const integratedResponse = getIntegratedShortcutResponse(input, orchestratorData)
    if (integratedResponse) return integratedResponse
  }

  // LINE WORKS ショートカット回答を最優先
  const lwResponse = getLineWorksShortcutResponse(input)
  if (lwResponse) return lwResponse

  // Sheets ショートカット回答を優先
  const sheetsResponse = getSheetsShortcutResponse(input)
  if (sheetsResponse) return sheetsResponse

  // Drive ショートカット回答
  const driveResponse = getDriveShortcutResponse(input)
  if (driveResponse) return driveResponse

  // カレンダーショートカット回答を優先
  const calendarResponse = getCalendarShortcutResponse(input)
  if (calendarResponse) return calendarResponse

  const modeResponses = mockAiResponses[mode]
  if (!modeResponses) return mockAiResponses['secretary']['default']

  for (const [key, val] of Object.entries(modeResponses)) {
    if (key !== 'default' && input.includes(key)) return val
  }
  return modeResponses['default'] ?? mockAiResponses['secretary']['default']
}

export default function AiChat({ onVoice, onNavigate }: Props) {
  const [activeMode, setActiveMode] = useState<AiMode>('secretary')
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const briefingMsgIdRef = useRef('briefing-morning')

  // Mission 1.1: 全Provider実データ対応・順次反映
  // 初期はデモ入力で即表示 → 各Providerが取得完了するたびに再計算・差し替え
  const dataRef = useRef<OrchestratorInput>(getDemoInput())
  const statusRef = useRef<ProviderStatusMap>({
    inbox: 'loading', schedule: 'loading', file: 'loading', business: 'loading', notification: 'loading',
  })
  const [orchResult, setOrchResult] = useState<OrchestratorResult>(() => assembleOrchestratorResult(dataRef.current))
  const [dataStatus, setDataStatus] = useState<ProviderStatusMap>(statusRef.current)
  const morningBriefing = useMemo(() => buildMorningBriefing(orchResult), [orchResult])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // ブリーフィングメッセージを再計算して差し替え（なければ追加）
  function refreshBriefingMessage() {
    const result = assembleOrchestratorResult(dataRef.current)
    setOrchResult(result)
    setDataStatus({ ...statusRef.current })
    const text = formatMorningBriefing(buildMorningBriefing(result), statusRef.current)
    const id = briefingMsgIdRef.current
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx === -1) {
        return [...prev, { id, role: 'assistant', content: text, timestamp: new Date() }]
      }
      const copy = prev.slice()
      copy[idx] = { ...copy[idx], content: text }
      return copy
    })
  }

  // Project SHOGUN 標準UI: 起動時に朝ブリーフィングを自動表示し、
  // 5Providerを並列・非同期取得して順次反映する（実データ対応）
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    refreshBriefingMessage() // デモ即表示（取得中）

    loadInboxItems().then((r) => {
      dataRef.current = { ...dataRef.current, inbox: r.items }
      statusRef.current = { ...statusRef.current, inbox: r.source }
      refreshBriefingMessage()
    }).catch(() => { statusRef.current = { ...statusRef.current, inbox: 'mock' }; refreshBriefingMessage() })

    loadScheduleItems().then((r) => {
      dataRef.current = { ...dataRef.current, schedule: r.items }
      statusRef.current = { ...statusRef.current, schedule: r.source }
      refreshBriefingMessage()
    }).catch(() => { statusRef.current = { ...statusRef.current, schedule: 'mock' }; refreshBriefingMessage() })

    loadFileItems().then((r) => {
      dataRef.current = { ...dataRef.current, files: r.items }
      statusRef.current = { ...statusRef.current, file: r.source }
      refreshBriefingMessage()
    }).catch(() => { statusRef.current = { ...statusRef.current, file: 'mock' }; refreshBriefingMessage() })

    loadMetricItems().then((r) => {
      dataRef.current = { ...dataRef.current, metrics: r.items }
      statusRef.current = { ...statusRef.current, business: r.source }
      refreshBriefingMessage()
    }).catch(() => { statusRef.current = { ...statusRef.current, business: 'mock' }; refreshBriefingMessage() })

    loadNotificationItems().then((r) => {
      dataRef.current = { ...dataRef.current, notifications: r.items }
      statusRef.current = { ...statusRef.current, notification: r.source }
      refreshBriefingMessage()
    }).catch(() => { statusRef.current = { ...statusRef.current, notification: 'mock' }; refreshBriefingMessage() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sendMessage(text: string) {
    if (!text.trim()) return
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    setTimeout(() => {
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: getMockResponse(activeMode, text, orchResult, dataStatus),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiMsg])
      setIsTyping(false)
    }, 1000)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function switchMode(mode: AiMode) {
    setActiveMode(mode)
    const modeConfig = aiModes.find((m) => m.id === mode)
    if (!modeConfig) return
    const switchMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: `**${modeConfig.icon} ${modeConfig.label}モードに切り替えました**\n\n${modeConfig.prompts.slice(0, 3).map((p) => `• ${p}`).join('\n')}\n\nなど、${modeConfig.label}に関することをお気軽にどうぞ。`,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, switchMsg])
  }

  const currentMode = aiModes.find((m) => m.id === activeMode)!
  const prompts = currentMode.prompts

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── Project SHOGUN: 朝ブリーフィング（最上段・主役）── */}
      <div
        style={{
          flexShrink: 0,
          background: 'linear-gradient(135deg, #0f2647 0%, #1B3D6F 100%)',
          padding: '8px 14px',
        }}
      >
        <button
          onClick={() => sendMessage('今朝のブリーフィングを見せて')}
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.12)',
            border: '1.5px solid rgba(255,255,255,0.3)',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 14,
            fontWeight: 800,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          ☀️ 今朝のブリーフィング（社長がやる {morningBriefing.ceoActions.length} / 任せる {morningBriefing.delegateActions.length} / AI監視 {morningBriefing.aiMonitorItems.length}）
        </button>
      </div>

      {/* ── AIモードタブバー ── */}
      <div
        ref={tabBarRef}
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          padding: '10px 14px 4px',
          borderBottom: '1px solid var(--border)',
          background: '#fff',
        }}
      >
        {aiModes.map((m) => {
          const isActive = m.id === activeMode
          return (
            <button
              key={m.id}
              onClick={() => switchMode(m.id)}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                background: isActive ? m.color : 'var(--bg)',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                border: isActive ? 'none' : '1.5px solid var(--border)',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── 統合AI ショートカット（Phase 10）── */}
      <div
        style={{
          flexShrink: 0,
          background: '#EEF2FF',
          borderBottom: '1px solid #C7D2FE',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#4338CA', marginBottom: 4 }}>
          🤖 統合AI · 全Provider横断ショートカット
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {INTEGRATED_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #C7D2FE',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#4338CA',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Gmailショートカット ── */}
      <div
        style={{
          flexShrink: 0,
          background: '#EFF6FF',
          borderBottom: '1px solid #BFDBFE',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#1D4ED8', marginBottom: 4 }}>
          📧 Gmailショートカット
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {GMAIL_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #BFDBFE',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#1D4ED8',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── カレンダーショートカット（Phase 6）── */}
      <div
        style={{
          flexShrink: 0,
          background: '#F0FDF4',
          borderBottom: '1px solid #BBF7D0',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#166534', marginBottom: 4 }}>
          📅 カレンダーショートカット
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {CALENDAR_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #BBF7D0',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#166534',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Driveショートカット（Phase 7）── */}
      <div
        style={{
          flexShrink: 0,
          background: '#FFFBEB',
          borderBottom: '1px solid #FDE68A',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#92400E', marginBottom: 4 }}>
          📁 Driveショートカット
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {DRIVE_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #FDE68A',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#92400E',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── LINE WORKSショートカット（Phase 9）── */}
      <div
        style={{
          flexShrink: 0,
          background: '#F0FDFA',
          borderBottom: '1px solid #CCFBF1',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#0F766E', marginBottom: 4 }}>
          💬 LINE WORKS通知ショートカット
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {LINEWORKS_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #CCFBF1',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#0F766E',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Sheetsショートカット（Phase 8）── */}
      <div
        style={{
          flexShrink: 0,
          background: '#F5F3FF',
          borderBottom: '1px solid #DDD6FE',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#5B21B6', marginBottom: 4 }}>
          📊 経営数字ショートカット
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {SHEETS_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #DDD6FE',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#5B21B6',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── プロンプト例（横スクロール） ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          padding: '8px 14px 6px',
          background: 'var(--bg)',
        }}
      >
        {prompts.map((s) => (
          <button
            key={s}
            onClick={() => sendMessage(s)}
            style={{
              flexShrink: 0,
              background: '#fff',
              border: `1.5px solid ${currentMode.color}30`,
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: currentMode.color,
              whiteSpace: 'nowrap',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── メッセージリスト ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          scrollbarWidth: 'none',
        }}
      >
        <DemoBanner />
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} modeColor={currentMode.color} />
        ))}
        {isTyping && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <AiAvatar icon={currentMode.icon} color={currentMode.color} />
            <div
              style={{
                background: '#fff',
                borderRadius: '18px 18px 18px 4px',
                padding: '12px 16px',
                boxShadow: 'var(--shadow)',
                display: 'flex',
                gap: 5,
                alignItems: 'center',
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    background: currentMode.color,
                    borderRadius: '50%',
                    animation: `chatBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── 入力エリア ── */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px calc(var(--nav-height) + var(--safe-bottom) + 10px)',
          background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => onNavigate('create')}
          style={{
            width: '100%',
            marginBottom: 8,
            padding: '9px 14px',
            borderRadius: 12,
            background: '#FFF7ED',
            border: '1.5px solid #FED7AA',
            color: '#C2410C',
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          ✍️ 作成依頼へ（文書・返信・指示文）
        </button>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            background: '#fff',
            borderRadius: 24,
            padding: '8px 8px 8px 16px',
            boxShadow: 'var(--shadow-md)',
            border: `1.5px solid ${currentMode.color}30`,
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`${currentMode.icon} ${currentMode.label}に聞く...`}
            rows={1}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: 15,
              lineHeight: 1.5,
              maxHeight: 100,
              background: 'transparent',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={onVoice}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
              color: 'var(--text-secondary)',
            }}
          >
            🎤
          </button>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: input.trim() ? currentMode.color : 'var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
              color: '#fff',
              transition: 'background 0.2s',
            }}
          >
            ↑
          </button>
        </div>
      </div>

      <style>{`
        @keyframes chatBounce {
          0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function AiAvatar({ icon, color }: { icon: string; color: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
  )
}

function ChatBubble({ message, modeColor }: { message: ChatMessage; modeColor: string }) {
  const isUser = message.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 10,
        alignItems: 'flex-end',
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: modeColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          🤖
        </div>
      )}
      <div
        style={{
          maxWidth: '78%',
          background: isUser ? modeColor : '#fff',
          color: isUser ? '#fff' : 'var(--text-primary)',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '11px 15px',
          fontSize: 14,
          lineHeight: 1.65,
          boxShadow: 'var(--shadow)',
          whiteSpace: 'pre-wrap',
        }}
        dangerouslySetInnerHTML={{
          __html: message.content
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br />'),
        }}
      />
    </div>
  )
}
