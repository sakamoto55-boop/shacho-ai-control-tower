import { useState, useMemo, useEffect } from 'react'
import type { PriorityAction, ActionSuggestion, TimelinePeriod } from '../../types'
import {
  companyHealthScore,
  priorityActions,
  timelinePeriods,
  searchIndex,
} from '../../data/mockData'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { mapToGmailDerivedTask } from '../../services/gmail/gmailMapper'
import { createGmailSummary } from '../../services/gmail/gmailAnalyzer'
import { fetchRawMessages } from '../../services/gmail/gmailClient'
import { googleAuth } from '../../services/google/googleAuth'
import type { GmailMessage } from '../../services/gmail/types'
import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { mapGoogleCalendarEventToUnifiedScheduleItem } from '../../services/calendar/calendarMapper'
import { createCalendarSummary } from '../../services/calendar/calendarAnalyzer'
import { calendarClient } from '../../services/calendar/calendarClient'
import { mockDriveFiles } from '../../services/drive/mockDrive'
import { mapGoogleDriveFileToUnifiedFileItem } from '../../services/drive/driveMapper'
import { createDriveSummary } from '../../services/drive/driveAnalyzer'
import { driveClient } from '../../services/drive/driveClient'
import { mockBusinessDataset } from '../../services/sheets/mockSheets'
import { createBusinessSummary, detectBusinessRisks } from '../../services/sheets/sheetsAnalyzer'
import { mockLineWorksNotifications } from '../../services/lineworks/mockLineworks'
import { mapLineWorksToUnifiedNotification } from '../../services/lineworks/lineworksMapper'
import { createNotificationSummary } from '../../services/lineworks/lineworksAnalyzer'
import type { UnifiedScheduleItem, UnifiedFileItem } from '../../core/providers/providerTypes'
import DemoBanner from '../DemoBanner'
import { runOrchestrator } from '../../core/ai-engine/aiOrchestrator'
import type { ActionDraft, DecisionItem } from '../../core/ai-engine/aiEngineTypes'
import { googleToken } from '../../services/google/googleToken'

// AI Engine: Schedule Provider (Phase 6) + File Provider (Phase 7) + BusinessData Provider (Phase 8) + Inbox Provider 横断参照

const IMPORTANCE_CONFIG = {
  critical: { label: '最優先', color: '#EF4444', bg: '#FEF2F2' },
  high:     { label: '重要',   color: '#F59E0B', bg: '#FFFBEB' },
  medium:   { label: '通常',   color: '#3B82F6', bg: '#EFF6FF' },
}

const HEALTH_CONFIG = {
  good:    { color: '#10B981', bg: '#D1FAE5', label: '良好' },
  warning: { color: '#F59E0B', bg: '#FEF3C7', label: '注意' },
  danger:  { color: '#EF4444', bg: '#FEE2E2', label: '要対応' },
  normal:  { color: '#6B7280', bg: '#F3F4F6', label: '普通' },
}

const TIMELINE_LABELS: Record<TimelinePeriod, string> = {
  yesterday:   '昨日',
  today:       '今日',
  tomorrow:    '明日',
  'this-week': '今週',
  'next-week': '来週',
  'this-month':'今月',
}

const CATEGORY_COLORS: Record<string, string> = {
  '人':  '#7C3AED',
  '案件':'#1B3D6F',
  '連絡':'#D97706',
  '書類':'#059669',
  '予定':'#2d5a9e',
  'タスク':'#DC2626',
}

// Inbox Provider 経由 (Phase 11: デモGmailまたは本番 Gmail ReadOnly)
const demoGmailMessages = mockGmailMessages

// Schedule Provider 経由 (Phase 6: デモCalendarまたは Google Calendar ReadOnly)
const demoScheduleItems = mockCalendarEvents
  .filter((e) => e.status !== 'cancelled')
  .map((e) => mapGoogleCalendarEventToUnifiedScheduleItem(e, 'demo'))
const demoCalendarSummary = createCalendarSummary(mockCalendarEvents)

// File Provider 経由 (Phase 7: デモDriveまたは Google Drive ReadOnly)
const demoFileItems = mockDriveFiles
  .filter((f) => !f.trashed)
  .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, 'デモDrive'))
const demoDriveSummary = createDriveSummary(mockDriveFiles)

export default function CockpitScreen({ demoMode }: { demoMode?: boolean }) {
  if (googleToken.hasToken()) {
    return <div className="screen-content"><DemoBanner /><div style={{background:'#fff',borderRadius:14,padding:18,boxShadow:'var(--shadow)'}}><h3 style={{margin:'0 0 8px'}}>コックピット実データ化中</h3><p style={{margin:0,color:'var(--text-muted)',lineHeight:1.7}}>メール以外の実データ連携が揃うまで、事故・SOS・財務・人員などの推定値は表示しません。ホームのProvider別状態をご確認ください。</p></div></div>
  }
  const [expandedActionId, setExpandedActionId] = useState<string | null>('pa1')
  const [activeSuggestion, setActiveSuggestion] = useState<ActionSuggestion | null>(null)
  const [activeTimeline, setActiveTimeline] = useState<TimelinePeriod>('today')
  const [searchQuery, setSearchQuery] = useState('')
  const [healthExpanded, setHealthExpanded] = useState(true)
  const [scheduleItems, setScheduleItems] = useState<UnifiedScheduleItem[]>(demoScheduleItems)
  const [scheduleSource, setScheduleSource] = useState<'demo' | 'api'>('demo')
  const [fileItems, setFileItems] = useState<UnifiedFileItem[]>(demoFileItems)
  const [fileSource, setFileSource] = useState<'demo' | 'api'>('demo')
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>(demoGmailMessages)
  const [gmailSource, setGmailSource] = useState<'demo' | 'api'>('demo')

  // BusinessData Provider（Phase 8）
  const businessDataset = mockBusinessDataset
  const businessSummary = createBusinessSummary(businessDataset)
  const businessRisks = detectBusinessRisks(businessDataset.metrics)

  // Notification Provider（Phase 9）— LINE WORKS
  const lwNotifications = useMemo(
    () => mockLineWorksNotifications.map(mapLineWorksToUnifiedNotification),
    []
  )
  const lwSummary = useMemo(() => createNotificationSummary(lwNotifications), [lwNotifications])
  const lwCritical = lwNotifications.filter((n) => n.urgency === 'critical')

  // AI Orchestrator（Phase 10）— 全Provider統合
  const orchestratorResult = useMemo(() => runOrchestrator(), [])
  const [approvalStatuses, setApprovalStatuses] = useState<Record<string, string>>({})

  function setDraftStatus(id: string, status: string) {
    setApprovalStatuses((prev) => ({ ...prev, [id]: status }))
  }

  useEffect(() => {
    calendarClient.fetchEvents().then((result) => {
      if (result.source !== 'mock') {
        setScheduleItems(result.events
          .filter((e) => e.status !== 'cancelled')
          .map((e) => mapGoogleCalendarEventToUnifiedScheduleItem(e, 'google-calendar')))
        setScheduleSource('api')
      }
    }).catch(() => { /* デモデータを維持 */ })

    driveClient.fetchFiles().then((result) => {
      if (result.source !== 'mock') {
        setFileItems(result.files
          .filter((f) => !f.trashed)
          .map((f) => mapGoogleDriveFileToUnifiedFileItem(f, 'Google Drive')))
        setFileSource('api')
      }
    }).catch(() => { /* デモデータを維持 */ })

    // Phase 11: Gmail 本番接続済みなら実データに切り替え（読み取り専用）
    // Calendar/Drive/Sheets/LINE WORKS はデモのまま
    if (googleAuth.isConnected()) {
      fetchRawMessages().then((messages) => {
        if (messages.length > 0) {
          setGmailMessages(messages)
          setGmailSource('api')
        }
      }).catch(() => { /* デモデータを維持 */ })
    }
  }, [])

  // Phase 11: Gmail サマリー・タスクは接続状態に応じて実データ or デモから生成
  const gmailDerivedTasks = useMemo(() => gmailMessages.map(mapToGmailDerivedTask), [gmailMessages])
  const gmailSummary = useMemo(() => createGmailSummary(gmailMessages), [gmailMessages])

  const calendarSummary = scheduleSource === 'api'
    ? { totalCount: scheduleItems.length, importanceACount: scheduleItems.filter((e) => e.priority === 'A').length, deadlineRiskCount: scheduleItems.filter((e) => e.deadlineRisk).length, travelRequiredCount: scheduleItems.filter((e) => e.location && !e.location.includes('会議室')).length }
    : demoCalendarSummary

  const driveSummary = useMemo(() => fileSource === 'api'
    ? {
        totalCount: fileItems.length,
        importanceACount: fileItems.filter((f) => f.importance === 'A').length,
        riskFlagCount: fileItems.filter((f) => f.riskFlag).length,
        bankCount: fileItems.filter((f) => f.category === '銀行').length,
        contractCount: fileItems.filter((f) => f.category === '契約').length,
        invoiceCount: fileItems.filter((f) => f.category === '請求').length,
        accidentCount: fileItems.filter((f) => f.category === '事故').length,
        auditCount: fileItems.filter((f) => f.category === '監査').length,
        lastModifiedAt: fileItems.length > 0 ? fileItems[0].modifiedAt : null,
      }
    : demoDriveSummary, [fileItems, fileSource, demoDriveSummary])

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return searchIndex.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.sub.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    )
  }, [searchQuery])

  const activeTimelineData = timelinePeriods.find((p) => p.period === activeTimeline)

  const scoreColor =
    companyHealthScore.total >= 80
      ? '#10B981'
      : companyHealthScore.total >= 60
        ? '#F59E0B'
        : '#EF4444'

  return (
    <div className="screen-content">
      <DemoBanner />

      {/* ── 今日30分以内にやること（Phase 10）── */}
      {orchestratorResult.todayPlan.immediateActions.length > 0 && (
        <div
          style={{
            background: '#ECFDF5',
            border: '2px solid #6EE7B7',
            borderRadius: 16,
            padding: '14px 16px',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#065F46' }}>
              今日30分以内にやること
            </span>
            <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800, marginLeft: 'auto' }}>
              {orchestratorResult.todayPlan.immediateActions.length}件
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orchestratorResult.todayPlan.immediateActions.map((action, i) => (
              <div
                key={action.id}
                style={{
                  background: action.urgency === 'critical' ? '#FFF8F8' : '#fff',
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: action.urgency === 'critical' ? '1.5px solid #FCA5A5' : '1px solid #A7F3D0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    background: '#065F46', color: '#fff',
                    borderRadius: '50%', width: 22, height: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ background: action.urgency === 'critical' ? '#FEE2E2' : '#D1FAE5', color: action.urgency === 'critical' ? '#991B1B' : '#065F46', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>
                    {action.urgency === 'critical' ? '🚨 緊急' : '⚡ 急務'}
                  </span>
                  <span style={{ fontSize: 10, color: '#059669', fontWeight: 700, marginLeft: 'auto' }}>
                    {action.timeEstimate}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#065F46', marginBottom: 3 }}>
                  {action.title}
                </div>
                <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5, marginBottom: 2 }}>
                  {action.suggestedAction}
                </div>
                <div style={{ fontSize: 10, color: '#6B7280' }}>
                  📌 {action.reason.slice(0, 60)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#059669', marginTop: 8, fontWeight: 600 }}>
            AI統合判断 · 全Provider横断 · 読み取り専用 · 外部実行なし
          </div>
        </div>
      )}

      {/* ── AI判断一言（Phase 10: 統合ブリーフィング）── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f2647 0%, #1B3D6F 60%, #2d5a9e 100%)',
          borderRadius: 18,
          padding: '16px',
          marginBottom: 14,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute', right: -20, top: -20,
            width: 100, height: 100, borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)', pointerEvents: 'none',
          }}
        />
        <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6 }}>
          🤖 AIからの一言 — {orchestratorResult.briefing.greeting} · {orchestratorResult.briefing.generatedAt.slice(0, 10)}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.6, marginBottom: 6 }}>
          {orchestratorResult.briefing.headline}
        </div>
        <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.5, marginBottom: 10 }}>
          {orchestratorResult.briefing.headlineReason}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {orchestratorResult.briefing.todayFocusItems.map((item, i) => (
            <span
              key={i}
              style={{
                background: 'rgba(239,68,68,0.6)',
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* ── 会社健康スコア ── */}
      <button
        onClick={() => setHealthExpanded(!healthExpanded)}
        style={{
          width: '100%',
          background: '#fff',
          borderRadius: healthExpanded ? '16px 16px 0 0' : 16,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: 'var(--shadow)',
          borderBottom: healthExpanded ? '1px solid var(--border)' : 'none',
          marginBottom: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏢</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>会社健康度</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {companyHealthScore.updatedAt} 更新
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: scoreColor }}>
              {companyHealthScore.total}
            </span>
            <span style={{ fontSize: 13, color: scoreColor, fontWeight: 700 }}>点</span>
          </div>
          <span
            style={{
              background: scoreColor,
              color: '#fff',
              borderRadius: 8,
              padding: '2px 8px',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            {companyHealthScore.grade}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {healthExpanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {healthExpanded && (
        <div
          style={{
            background: '#fff',
            borderRadius: '0 0 16px 16px',
            boxShadow: 'var(--shadow)',
            padding: '14px 16px',
            marginBottom: 14,
          }}
        >
          {/* スコアバー */}
          <div
            style={{
              height: 8, borderRadius: 999,
              background: '#E2E8F0', marginBottom: 14, overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${companyHealthScore.total}%`,
                background: `linear-gradient(90deg, ${scoreColor}, ${scoreColor}cc)`,
                borderRadius: 999,
                transition: 'width 0.6s ease',
              }}
            />
          </div>

          {/* 内訳グリッド */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {companyHealthScore.breakdown.map((item) => {
              const cfg = HEALTH_CONFIG[item.status]
              return (
                <div
                  key={item.category}
                  style={{
                    background: cfg.bg,
                    borderRadius: 10,
                    padding: '10px 8px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 2 }}>{item.icon}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 2 }}>
                    {item.category}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: cfg.color }}>
                    {cfg.label}
                  </div>
                </div>
              )
            })}
          </div>

          {/* コメント */}
          <div
            style={{
              background: 'var(--bg)',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}
          >
            💡 {companyHealthScore.comment}
          </div>
        </div>
      )}

      {/* ── 今日の優先順位 TOP5（Phase 10: AI統合版）── */}
      <div className="section-label">🎯 今日の優先順位 TOP 5（AI統合判断）</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {orchestratorResult.todayPlan.decisions.slice(0, 5).map((decision) => (
          <DecisionCard key={decision.id} decision={decision} />
        ))}
        {orchestratorResult.todayPlan.decisions.length === 0 && priorityActions.map((action) => (
          <PriorityActionCard
            key={action.id}
            action={action}
            expanded={expandedActionId === action.id}
            onToggle={() =>
              setExpandedActionId(expandedActionId === action.id ? null : action.id)
            }
            onSuggestion={setActiveSuggestion}
          />
        ))}
      </div>

      {/* ── Schedule Provider — 今日の予定 ── */}
      <div
        style={{
          background: '#F0FDF4',
          border: '1.5px solid #BBF7D0',
          borderRadius: 'var(--radius)',
          padding: '14px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18 }}>📅</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#166534' }}>
              今日の予定：{calendarSummary.totalCount}件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {scheduleSource === 'demo' && demoMode !== false && (
              <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
                デモCalendar
              </span>
            )}
            <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              読み取り専用
            </span>
            <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              予定変更なし
            </span>
          </div>
        </div>

        {/* カウント行 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { label: '重要A', v: calendarSummary.importanceACount, c: '#EF4444', bg: '#FEE2E2' },
            { label: '移動注意', v: calendarSummary.travelRequiredCount, c: '#D97706', bg: '#FEF3C7' },
            { label: '期限あり', v: calendarSummary.deadlineRiskCount, c: '#DC2626', bg: '#FEE2E2' },
            { label: '銀行', v: 'bankCount' in calendarSummary ? calendarSummary.bankCount : scheduleItems.filter((e) => e.category === '銀行').length, c: '#1B3D6F', bg: '#DBEAFE' },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '3px 8px', display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.c }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.c }}>{typeof s.v === 'number' ? s.v : 0}件</span>
            </div>
          ))}
        </div>

        {/* 予定リスト */}
        <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #BBF7D0' }}>
          {scheduleItems.slice(0, 5).map((event, i) => {
            const timeStr = event.isAllDay
              ? '終日'
              : new Date(event.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
            const alertColor = event.alertLevel === 'danger' ? '#EF4444' : event.alertLevel === 'warning' ? '#F59E0B' : '#166534'
            return (
              <div
                key={event.id}
                style={{
                  padding: '10px 12px',
                  borderBottom: i < scheduleItems.length - 1 && i < 4 ? '1px solid #DCFCE7' : 'none',
                  background: event.alertLevel === 'danger' ? '#FFF8F8' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', minWidth: 40 }}>
                    {timeStr}
                  </span>
                  <span style={{ background: alertColor + '20', color: alertColor, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800 }}>
                    {event.priority}
                  </span>
                  <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                    {event.category}
                  </span>
                  {event.deadlineRisk && (
                    <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      期限
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 1 }}>
                  {event.title}
                </div>
                {event.location && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    📍 {event.location}
                  </div>
                )}
                {event.suggestedAction && (
                  <div style={{ fontSize: 11, color: '#166534', marginTop: 2, fontWeight: 600 }}>
                    💡 {event.suggestedAction}
                  </div>
                )}
              </div>
            )
          })}
          {scheduleItems.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              本日の予定はありません
            </div>
          )}
        </div>

        <div style={{ marginTop: 8, fontSize: 10, color: '#166534', fontWeight: 600 }}>
          元データ：{scheduleSource === 'api' ? 'Google Calendar ReadOnly' : 'デモCalendar'} · 予定作成・変更なし · 社長確認のみ
        </div>
      </div>

      {/* ── 経営数字サマリー（Phase 8）── */}
      <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#5B21B6', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📊 経営数字サマリー</span>
          <span style={{ fontSize: 10, background: '#EDE9FE', color: '#6D28D9', borderRadius: 999, padding: '2px 8px' }}>デモSheets</span>
        </div>

        {/* 危険指標チップ */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { label: `🔴 危険 ${businessSummary.dangerCount}件`, show: businessSummary.dangerCount > 0, color: '#991B1B', bg: '#FEE2E2' },
            { label: `⚠️ 注意 ${businessSummary.warningCount}件`, show: businessSummary.warningCount > 0, color: '#92400E', bg: '#FEF3C7' },
          ].filter(c => c.show).map((c) => (
            <span key={c.label} style={{ fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, borderRadius: 999, padding: '3px 10px' }}>{c.label}</span>
          ))}
        </div>

        {/* 主要指標グリッド */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          {[
            { label: '現金残高', value: businessSummary.cashBalance !== null ? `¥${(businessSummary.cashBalance / 10000).toFixed(0)}万` : '—', alert: (businessSummary.cashBalance ?? 999999999) < 5000000 },
            { label: '未請求', value: businessSummary.unbilledAmount !== null ? `¥${(businessSummary.unbilledAmount / 10000).toFixed(0)}万` : '—', alert: (businessSummary.unbilledAmount ?? 0) > 5000000 },
            { label: '未回収', value: businessSummary.uncollectedAmount !== null ? `¥${(businessSummary.uncollectedAmount / 10000).toFixed(0)}万` : '—', alert: (businessSummary.uncollectedAmount ?? 0) > 3000000 },
            { label: '今月粗利率', value: businessSummary.grossProfitRate !== null ? `${businessSummary.grossProfitRate}%` : '—', alert: (businessSummary.grossProfitRate ?? 100) < 30 },
          ].map((item) => (
            <div key={item.label} style={{ background: item.alert ? '#FEF2F2' : '#fff', borderRadius: 8, padding: '8px 10px', border: `1px solid ${item.alert ? '#FCA5A5' : '#E9D5FF'}` }}>
              <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: item.alert ? '#991B1B' : '#1F2937' }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* リスク一覧（最大3件） */}
        {businessRisks.slice(0, 3).map((risk) => (
          <div key={risk.metricId} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid #EDE9FE' }}>
            <span style={{ fontSize: 10, fontWeight: 800, background: risk.severity === 'critical' || risk.severity === 'high' ? '#FEE2E2' : '#FEF3C7', color: risk.severity === 'critical' || risk.severity === 'high' ? '#991B1B' : '#92400E', borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>
              {risk.severity === 'critical' ? '最重要' : risk.severity === 'high' ? '重要' : '注意'}
            </span>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
              <strong>{risk.label}</strong>{risk.description ? `：${risk.description}` : ''}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 8, fontWeight: 600 }}>
          データ元：デモSheets · 読み取り専用 · セル更新・行追加・削除なし
        </div>
      </div>

      {/* ── LINE WORKS 通知（Phase 9）── */}
      <div style={{ background: '#F0FDFA', border: '1.5px solid #CCFBF1', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#0F766E', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>💬 LINE WORKS通知</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ fontSize: 10, background: '#CCFBF1', color: '#0F766E', borderRadius: 999, padding: '2px 8px' }}>デモ</span>
            <span style={{ fontSize: 10, background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 8px' }}>読み取り専用</span>
          </div>
        </div>

        {/* カウントチップ */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { label: `🚨 緊急 ${lwSummary.criticalCount}件`, show: lwSummary.criticalCount > 0, color: '#991B1B', bg: '#FEE2E2' },
            { label: `⚠️ 重要 ${lwSummary.highCount}件`, show: lwSummary.highCount > 0, color: '#92400E', bg: '#FEF3C7' },
            { label: `🚑 事故 ${lwSummary.accidentCount}件`, show: lwSummary.accidentCount > 0, color: '#991B1B', bg: '#FEE2E2' },
            { label: `SOS ${lwSummary.sosCount}件`, show: lwSummary.sosCount > 0, color: '#991B1B', bg: '#FEE2E2' },
          ].filter((c) => c.show).map((c) => (
            <span key={c.label} style={{ fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, borderRadius: 999, padding: '3px 10px' }}>{c.label}</span>
          ))}
        </div>

        {/* 緊急通知カード */}
        <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #CCFBF1' }}>
          {lwCritical.slice(0, 3).map((notif, i) => (
            <div
              key={notif.id}
              style={{
                padding: '10px 12px',
                borderBottom: i < lwCritical.length - 1 && i < 2 ? '1px solid #CCFBF1' : 'none',
                background: notif.riskFlag ? '#FEF2F2' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ background: notif.urgency === 'critical' ? '#FEE2E2' : '#FEF3C7', color: notif.urgency === 'critical' ? '#991B1B' : '#92400E', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800 }}>
                  {notif.urgency === 'critical' ? '🚨 緊急' : '⚠️ 重要'}
                </span>
                <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                  {notif.category}
                </span>
                {notif.riskFlag && (
                  <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                    リスク
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                {notif.title}
              </div>
              {notif.suggestedAction && (
                <div style={{ fontSize: 11, color: '#0F766E', fontWeight: 600 }}>
                  💡 {notif.suggestedAction}
                </div>
              )}
            </div>
          ))}
          {lwCritical.length === 0 && (
            <div style={{ padding: '14px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              緊急通知なし
            </div>
          )}
        </div>

        <div style={{ fontSize: 10, color: '#0F766E', marginTop: 8, fontWeight: 600 }}>
          元データ：デモLINE WORKS · 本番未接続 · 送信・既読化・削除なし
        </div>
      </div>

      {/* ── File Provider — 最近の重要ファイル ── */}
      <div
        style={{
          background: '#FFFBEB',
          border: '1.5px solid #FDE68A',
          borderRadius: 'var(--radius)',
          padding: '14px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18 }}>📁</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#92400E' }}>
              最近の重要ファイル：{driveSummary.totalCount}件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {fileSource === 'demo' && demoMode !== false && (
              <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
                デモDrive
              </span>
            )}
            <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              読み取り専用
            </span>
            <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              変更・削除なし
            </span>
          </div>
        </div>

        {/* カウント行 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { label: '重要A', v: driveSummary.importanceACount, c: '#EF4444', bg: '#FEE2E2' },
            { label: 'リスク', v: driveSummary.riskFlagCount, c: '#DC2626', bg: '#FEF2F2' },
            { label: '銀行', v: driveSummary.bankCount, c: '#1B3D6F', bg: '#DBEAFE' },
            { label: '契約', v: driveSummary.contractCount, c: '#7C3AED', bg: '#EDE9FE' },
            { label: '請求', v: driveSummary.invoiceCount, c: '#D97706', bg: '#FEF3C7' },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '3px 8px', display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.c }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.c }}>{s.v}件</span>
            </div>
          ))}
        </div>

        {/* ファイルリスト */}
        <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #FDE68A' }}>
          {fileItems.slice(0, 5).map((file, i) => {
            const alertColor = file.alertLevel === 'danger' ? '#EF4444' : file.alertLevel === 'warning' ? '#F59E0B' : '#92400E'
            const modifiedStr = (() => {
              try { return new Date(file.modifiedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) } catch { return '' }
            })()
            return (
              <div
                key={file.id}
                style={{
                  padding: '10px 12px',
                  borderBottom: i < fileItems.length - 1 && i < 4 ? '1px solid #FDE68A' : 'none',
                  background: file.riskFlag ? '#FFFBEB' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#9CA3AF', minWidth: 30 }}>
                    {file.fileType}
                  </span>
                  <span style={{ background: alertColor + '20', color: alertColor, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800 }}>
                    {file.importance}
                  </span>
                  <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                    {file.category}
                  </span>
                  {file.riskFlag && (
                    <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      ⚠️ 要確認
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 'auto' }}>{modifiedStr}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 1, wordBreak: 'break-all' }}>
                  {file.name}
                </div>
                {file.folderName && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    📂 {file.folderName}
                  </div>
                )}
                {file.suggestedAction && (
                  <div style={{ fontSize: 11, color: '#92400E', marginTop: 2, fontWeight: 600 }}>
                    💡 {file.suggestedAction}
                  </div>
                )}
              </div>
            )
          })}
          {fileItems.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              ファイルが見つかりません
            </div>
          )}
        </div>

        <div style={{ marginTop: 8, fontSize: 10, color: '#92400E', fontWeight: 600 }}>
          元データ：{fileSource === 'api' ? 'Google Drive ReadOnly' : 'デモDrive'} · ファイル作成・変更・削除なし · 社長確認のみ
        </div>
      </div>

      {/* ── Gmailからの要対応 ── */}
      <div
        style={{
          background: '#EFF6FF',
          border: '1.5px solid #BFDBFE',
          borderRadius: 'var(--radius)',
          padding: '14px',
          marginBottom: 14,
        }}
      >
        {/* ヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18 }}>📧</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#1D4ED8' }}>
              Gmailからの要対応：{gmailSummary.totalCount}件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {gmailSource === 'api' ? (
              <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
                本番Gmail接続
              </span>
            ) : (
              <span style={{ background: '#DBEAFE', color: '#1D4ED8', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
                デモGmail
              </span>
            )}
            <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              読み取り専用
            </span>
            <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              送信なし
            </span>
          </div>
        </div>

        {/* カウント行 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { label: '重要A', v: gmailSummary.priorityACount, c: '#EF4444', bg: '#FEE2E2' },
            { label: '本日中', v: gmailSummary.todayDueCount, c: '#DC2626', bg: '#FEE2E2' },
            { label: '銀行', v: gmailSummary.bankCount, c: '#1B3D6F', bg: '#DBEAFE' },
            { label: '請求', v: gmailSummary.billingCount, c: '#92400E', bg: '#FEF3C7' },
            { label: '契約', v: gmailSummary.contractCount, c: '#7C3AED', bg: '#EDE9FE' },
            { label: '事故', v: gmailSummary.accidentCount, c: '#6B7280', bg: '#F3F4F6' },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '3px 8px', display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.c }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.c }}>{s.v}件</span>
            </div>
          ))}
        </div>

        {/* TOP3メール */}
        <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #BFDBFE' }}>
          {gmailSummary.topItems.map((msg, i) => {
            const task = gmailDerivedTasks.find((t) => t.gmailMessageId === msg.id)!
            const pColor = task.priority === 'A' ? '#EF4444' : '#F59E0B'
            return (
              <div
                key={msg.id}
                style={{
                  padding: '10px 12px',
                  borderBottom: i < gmailSummary.topItems.length - 1 ? '1px solid #DBEAFE' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ background: pColor + '20', color: pColor, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800 }}>
                    {task.priority}
                  </span>
                  <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                    {task.taskType}
                  </span>
                  {task.estimatedDeadline && (
                    <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      {task.estimatedDeadline}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {task.subject}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {task.from} · {task.recommendedAction}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 8, fontSize: 10, color: '#1D4ED8', fontWeight: 600 }}>
          {gmailSource === 'api'
            ? '元データ：本番Gmail（gmail.readonly）· 実データ取得済み · 返信未送信 · 社長承認待ち · 外部送信なし'
            : '元データ：デモGmail · 本番Gmail未接続 · 返信未送信 · 社長承認待ち'}
        </div>
      </div>

      {/* ── 時系列ビュー ── */}
      <div className="section-label">📅 時系列ビュー</div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 10,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          paddingBottom: 2,
        }}
      >
        {(Object.keys(TIMELINE_LABELS) as TimelinePeriod[]).map((period) => (
          <button
            key={period}
            onClick={() => setActiveTimeline(period)}
            style={{
              flexShrink: 0,
              padding: '7px 14px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: activeTimeline === period ? 'var(--navy)' : '#fff',
              color: activeTimeline === period ? '#fff' : 'var(--text-secondary)',
              border: activeTimeline === period ? 'none' : '1.5px solid var(--border)',
              boxShadow: activeTimeline === period ? 'none' : 'var(--shadow)',
            }}
          >
            {TIMELINE_LABELS[period]}
          </button>
        ))}
      </div>

      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          overflow: 'hidden',
          marginBottom: 18,
        }}
      >
        {activeTimelineData?.events.map((event, i) => {
          const isLast = i === (activeTimelineData.events.length - 1)
          const alertColor =
            event.alertLevel === 'danger'
              ? '#EF4444'
              : event.alertLevel === 'warning'
                ? '#F59E0B'
                : 'var(--text-muted)'
          const dot =
            event.alertLevel === 'danger'
              ? '🔴'
              : event.alertLevel === 'warning'
                ? '🟡'
                : '⚪'

          return (
            <div
              key={event.id}
              style={{
                padding: '12px 16px',
                borderBottom: isLast ? 'none' : '1px solid var(--border)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                background: event.alertLevel === 'danger' ? '#FFF8F8' : '#fff',
              }}
            >
              <span style={{ fontSize: 14, marginTop: 1 }}>{dot}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: alertColor, lineHeight: 1.4 }}>
                  {event.title}
                </div>
                {event.time && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {event.time}
                  </div>
                )}
              </div>
              <span
                style={{
                  flexShrink: 0,
                  background: '#F1F5F9',
                  borderRadius: 6,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                }}
              >
                {event.category}
              </span>
            </div>
          )
        })}
        {!activeTimelineData?.events.length && (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-muted)',
            }}
          >
            この期間の予定・イベントはありません
          </div>
        )}
      </div>

      {/* ── AI会社検索 ── */}
      <div className="section-label">🔍 会社情報を検索</div>
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          boxShadow: 'var(--shadow)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 18 }}>🔍</span>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="人・案件・会社・車両・書類を検索"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: 15,
            color: 'var(--text-primary)',
            background: 'transparent',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ color: 'var(--text-muted)', fontSize: 16, fontWeight: 700 }}
          >
            ✕
          </button>
        )}
      </div>

      {searchQuery && (
        <div
          style={{
            background: '#fff',
            borderRadius: 14,
            boxShadow: 'var(--shadow)',
            overflow: 'hidden',
            marginBottom: 18,
          }}
        >
          {searchResults.length === 0 ? (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-muted)',
              }}
            >
              「{searchQuery}」に一致する情報が見つかりません
            </div>
          ) : (
            searchResults.map((result, i) => {
              const isLast = i === searchResults.length - 1
              const catColor = CATEGORY_COLORS[result.category] ?? '#6B7280'
              const alertColor =
                result.alertLevel === 'danger'
                  ? '#EF4444'
                  : result.alertLevel === 'warning'
                    ? '#F59E0B'
                    : 'var(--text-primary)'

              return (
                <div
                  key={result.id}
                  style={{
                    padding: '11px 16px',
                    borderBottom: isLast ? 'none' : '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: result.alertLevel === 'danger' ? '#FFF8F8' : '#fff',
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      background: catColor + '20',
                      color: catColor,
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 800,
                      minWidth: 36,
                      textAlign: 'center',
                    }}
                  >
                    {result.category}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: alertColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {result.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {result.sub}
                    </div>
                  </div>
                  {result.alertLevel && (
                    <span style={{ fontSize: 14 }}>
                      {result.alertLevel === 'danger' ? '🔴' : '🟡'}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {!searchQuery && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--blue-light)',
            borderRadius: 12,
            fontSize: 12,
            color: 'var(--navy)',
            lineHeight: 1.6,
            marginBottom: 14,
          }}
        >
          💡 「加藤」「銀行」「未請求」「事故」「お結び」「車両」などで検索できます。
          Gmail・LINE WORKS連携後はリアルタイムデータが表示されます。
        </div>
      )}

      {/* ── 社長承認待ちアクション（Phase 10）── */}
      {orchestratorResult.approvalQueue.length > 0 && (
        <div
          style={{
            background: '#FFFBEB',
            border: '2px solid #FDE68A',
            borderRadius: 16,
            padding: '14px 16px',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#92400E' }}>
              社長承認待ちアクション
            </span>
            <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 800, marginLeft: 'auto' }}>
              {orchestratorResult.approvalQueue.length}件
            </span>
          </div>
          <div
            style={{
              background: '#FEF3C7',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 11,
              color: '#92400E',
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            ⚠️ 以下は下書きのみです。外部送信・保存は行われていません。承認後も実行はPhase 11以降です。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orchestratorResult.approvalQueue.map((draft) => (
              <ApprovalDraftCard
                key={draft.id}
                draft={draft}
                status={approvalStatuses[draft.id] ?? 'pending'}
                onStatusChange={(s) => setDraftStatus(draft.id, s)}
              />
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#B45309', marginTop: 8, fontWeight: 600 }}>
            社長承認フロー · 外部送信なし · 保存なし · Phase 11以降で実行設計
          </div>
        </div>
      )}

      {/* ワンタップ実行モーダル */}
      {activeSuggestion && (
        <SuggestionModal
          suggestion={activeSuggestion}
          onClose={() => setActiveSuggestion(null)}
        />
      )}
    </div>
  )
}

// ── Phase 10: 統合決断カード ──────────────────────────────
function DecisionCard({ decision }: { decision: DecisionItem }) {
  const [expanded, setExpanded] = useState(false)
  const urgencyColor = decision.urgency === 'critical' ? '#EF4444' : decision.urgency === 'high' ? '#F59E0B' : '#3B82F6'
  const urgencyBg = decision.urgency === 'critical' ? '#FEE2E2' : decision.urgency === 'high' ? '#FEF3C7' : '#EFF6FF'
  const urgencyLabel = decision.urgency === 'critical' ? '🚨 緊急' : decision.urgency === 'high' ? '⚠️ 重要' : '📋 通常'

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
        border: decision.urgency === 'critical' ? '1.5px solid #FCA5A5' : '1.5px solid transparent',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          textAlign: 'left',
          background: decision.urgency === 'critical' ? '#FFF8F8' : '#fff',
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: decision.rank === 1 ? '#EF4444' : decision.rank === 2 ? '#F59E0B' : 'var(--navy)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 900, flexShrink: 0, marginTop: 1,
        }}>
          {decision.rank}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ background: urgencyBg, color: urgencyColor, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>
              {urgencyLabel}
            </span>
            <span style={{ background: '#F1F5F9', color: 'var(--text-secondary)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
              {decision.category}
            </span>
            {decision.isImmediate && (
              <span style={{ background: '#ECFDF5', color: '#065F46', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                ⚡ 30分以内
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 3 }}>
            {decision.title}
          </div>
          <div style={{ fontSize: 11, color: urgencyColor, fontWeight: 700 }}>
            {decision.timeEstimate}
          </div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0, marginTop: 6 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>📌 なぜ優先すべきか</div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}>
              {decision.reason}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>✅ 推奨アクション</div>
            <div style={{ fontSize: 12, color: 'var(--navy)', fontWeight: 600, lineHeight: 1.5, background: 'var(--blue-light)', borderRadius: 10, padding: '10px 12px' }}>
              {decision.suggestedAction}
            </div>
          </div>
          {decision.evidenceSources.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>🔗 根拠データ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {decision.evidenceSources.slice(0, 3).map((src) => (
                  <div key={src.id} style={{ background: '#F8FAFC', borderRadius: 8, padding: '6px 10px', fontSize: 11, color: '#374151', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ background: '#E2E8F0', color: '#475569', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{src.type}</span>
                    <span style={{ fontWeight: 600 }}>{src.title}</span>
                    {src.snippet && <span style={{ color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {src.snippet}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Phase 10: 社長承認待ちカード ─────────────────────────
function ApprovalDraftCard({
  draft,
  status,
  onStatusChange,
}: {
  draft: ActionDraft
  status: string
  onStatusChange: (s: string) => void
}) {
  const [showDraft, setShowDraft] = useState(false)
  const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: '#FEF3C7', color: '#92400E', label: '未承認' },
    approved: { bg: '#D1FAE5', color: '#065F46', label: '承認予定' },
    rejected: { bg: '#FEE2E2', color: '#991B1B', label: '差し戻し' },
    deferred: { bg: '#E0E7FF', color: '#3730A3', label: '保留' },
  }
  const cfg = statusConfig[status] ?? statusConfig.pending

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #FDE68A', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>
            {draft.actionType === 'reply' ? '返信下書き' : draft.actionType === 'confirm' ? '確認依頼' : draft.actionType === 'report' ? '報告連絡' : draft.actionType}
          </span>
          <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 800, marginLeft: 'auto' }}>
            {cfg.label}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#1F2937', marginBottom: 3 }}>
          {draft.title}
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
          対象: {draft.targetName} · {draft.targetContext.slice(0, 40)}
        </div>
        <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.5, marginBottom: 8 }}>
          📌 {draft.reason}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowDraft(!showDraft)}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: '#F3F4F6', color: '#374151' }}
          >
            {showDraft ? '▲ 閉じる' : '👁 内容を見る'}
          </button>
          <button
            onClick={() => onStatusChange('approved')}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: status === 'approved' ? '#D1FAE5' : '#F3F4F6', color: status === 'approved' ? '#065F46' : '#374151' }}
          >
            ✓ 承認予定
          </button>
          <button
            onClick={() => onStatusChange('rejected')}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: status === 'rejected' ? '#FEE2E2' : '#F3F4F6', color: status === 'rejected' ? '#991B1B' : '#374151' }}
          >
            ✕ 差し戻し
          </button>
          <button
            onClick={() => onStatusChange('deferred')}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: status === 'deferred' ? '#E0E7FF' : '#F3F4F6', color: status === 'deferred' ? '#3730A3' : '#374151' }}
          >
            ⏸ 保留
          </button>
        </div>
        {showDraft && (
          <div style={{ marginTop: 10, background: '#FAFBFC', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#374151', lineHeight: 1.8, whiteSpace: 'pre-wrap', border: '1px solid #E2E8F0' }}>
            {draft.draftText}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 優先順位カード ─────────────────────────────────────────
function PriorityActionCard({
  action,
  expanded,
  onToggle,
  onSuggestion,
}: {
  action: PriorityAction
  expanded: boolean
  onToggle: () => void
  onSuggestion: (s: ActionSuggestion) => void
}) {
  const imp = IMPORTANCE_CONFIG[action.importance]

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
        border: action.importance === 'critical' ? '1.5px solid #FCA5A5' : '1.5px solid transparent',
      }}
    >
      {/* ヘッダー行 */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          textAlign: 'left',
          background: action.importance === 'critical' ? '#FFF8F8' : '#fff',
        }}
      >
        {/* ランク */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: action.rank === 1 ? '#EF4444' : action.rank === 2 ? '#F59E0B' : 'var(--navy)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 900,
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {action.rank}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span
              style={{
                background: imp.bg,
                color: imp.color,
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {imp.label}
            </span>
            <span
              style={{
                background: '#F1F5F9',
                color: 'var(--text-secondary)',
                borderRadius: 6,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {action.category}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 3 }}>
            {action.title}
          </div>
          <div style={{ fontSize: 11, color: imp.color, fontWeight: 700 }}>
            期限：{action.deadline}
          </div>
        </div>

        <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0, marginTop: 6 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* 展開エリア */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '14px 16px',
          }}
        >
          {/* 理由 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              📌 なぜ優先すべきか
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-primary)',
                lineHeight: 1.6,
                background: 'var(--bg)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              {action.reason}
            </div>
          </div>

          {/* 推奨アクション */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              ✅ 推奨アクション
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--navy)',
                fontWeight: 600,
                lineHeight: 1.5,
                background: 'var(--blue-light)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              {action.recommendedAction}
            </div>
          </div>

          {/* ワンタップ実行 */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
            ⚡ ワンタップで実行
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {action.suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSuggestion(s)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background: 'var(--navy)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ワンタップ実行モーダル ─────────────────────────────────
function SuggestionModal({
  suggestion,
  onClose,
}: {
  suggestion: ActionSuggestion
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard?.writeText(suggestion.draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      {/* バックドロップ */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
        }}
      />

      {/* ボトムシート */}
      <div
        style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          background: '#fff',
          borderRadius: '20px 20px 0 0',
          zIndex: 201,
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '0 0 env(safe-area-inset-bottom, 16px)',
        }}
      >
        {/* ハンドルバー */}
        <div
          style={{
            width: 40, height: 4, borderRadius: 999,
            background: '#CBD5E1', margin: '12px auto 0',
          }}
        />

        {/* ヘッダー */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px 10px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{suggestion.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>
                {suggestion.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                仮生成サンプル（APIキー不要）
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30,
              borderRadius: '50%',
              background: '#F1F5F9',
              color: 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* 本文 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            fontSize: 13,
            lineHeight: 1.8,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            background: '#FAFBFC',
          }}
        >
          {suggestion.draft}
        </div>

        {/* フッター */}
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              minHeight: 48,
              borderRadius: 14,
              background: copied ? '#10B981' : 'var(--navy)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {copied ? '✅ コピーしました' : '📋 コピーする'}
          </button>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            💡 この出力は仮データです。Claude API接続後は実際の状況に応じた内容が生成されます。
          </div>
        </div>
      </div>
    </>
  )
}
