import { useState, useMemo } from 'react'
import type { Screen } from '../../types'
import { actionItems, todayBriefing, situationCards, dashboardMetrics } from '../../data/mockData'
import DemoBanner from '../DemoBanner'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { createGmailSummary } from '../../services/gmail/gmailAnalyzer'
import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { createCalendarSummary } from '../../services/calendar/calendarAnalyzer'
import { mockDriveFiles } from '../../services/drive/mockDrive'
import { createDriveSummary } from '../../services/drive/driveAnalyzer'
import { mockBusinessDataset } from '../../services/sheets/mockSheets'
import { createBusinessSummary, detectBusinessRisks } from '../../services/sheets/sheetsAnalyzer'
import { mockLineWorksNotifications } from '../../services/lineworks/mockLineworks'
import { mapLineWorksToUnifiedNotification } from '../../services/lineworks/lineworksMapper'
import { createNotificationSummary } from '../../services/lineworks/lineworksAnalyzer'
import { runOrchestrator } from '../../core/ai-engine/aiOrchestrator'

interface Props {
  onNavigate: (screen: Screen) => void
  company?: string
  onVoice: () => void
}

const priorityACount = actionItems.filter((i) => i.priority === 'A' && !i.isRead).length
const alertMetrics = dashboardMetrics.filter((m) => m.alert).length

export default function Home({ onNavigate, onVoice }: Props) {
  const [briefingExpanded, setBriefingExpanded] = useState(true)
  const orchestratorResult = useMemo(() => runOrchestrator(), [])
  const gmailSummary = useMemo(() => createGmailSummary(mockGmailMessages), [])
  const calendarSummary = useMemo(() => createCalendarSummary(mockCalendarEvents), [])
  const nextEvent = mockCalendarEvents.find((e) => e.status !== 'cancelled' && e.start.dateTime)
  const nextEventTime = nextEvent?.start.dateTime
    ? new Date(nextEvent.start.dateTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : null
  const driveSummary = useMemo(() => createDriveSummary(mockDriveFiles.filter((f) => !f.trashed)), [])
  const latestFile = mockDriveFiles.filter((f) => !f.trashed)[0]
  const businessSummary = useMemo(() => createBusinessSummary(mockBusinessDataset), [])
  const businessRisks = useMemo(() => detectBusinessRisks(mockBusinessDataset.metrics), [])
  const lwNotifications = useMemo(
    () => mockLineWorksNotifications.map(mapLineWorksToUnifiedNotification),
    []
  )
  const lwSummary = useMemo(() => createNotificationSummary(lwNotifications), [lwNotifications])
  const lwCritical = lwNotifications.filter((n) => n.urgency === 'critical' || n.riskFlag)
  const latestModified = latestFile?.modifiedTime
    ? new Date(latestFile.modifiedTime).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const quickCards = [
    {
      screen: 'chat' as Screen,
      icon: '🤖',
      label: 'AIに相談する',
      sub: 'チャットで即サポート',
      color: '#1B3D6F',
      badge: null,
    },
    {
      screen: 'actions' as Screen,
      icon: '⚡',
      label: '今日の要対応',
      sub: `優先度A: ${priorityACount}件`,
      color: '#EF4444',
      badge: priorityACount,
    },
    {
      screen: 'create' as Screen,
      icon: '✍️',
      label: '資料を作る',
      sub: '文書・返信・指示文',
      color: '#F97316',
      badge: null,
    },
    {
      screen: 'dashboard' as Screen,
      icon: '📈',
      label: '経営を見る',
      sub: `注意: ${alertMetrics}件`,
      color: '#2d5a9e',
      badge: alertMetrics > 0 ? alertMetrics : null,
    },
  ]

  return (
    <div className="screen-content">
      <DemoBanner />

      {/* ── Schedule Provider — 今日の予定 ── */}
      <div
        style={{
          background: '#F0FDF4',
          border: '1.5px solid #BBF7D0',
          borderRadius: 14,
          padding: '12px 14px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>📅</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#166534' }}>
              今日の予定：{calendarSummary.totalCount}件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              デモCalendar
            </span>
            <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              読み取り専用
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {[
            { label: '重要', value: calendarSummary.importanceACount + '件', color: '#EF4444', bg: '#FEE2E2' },
            { label: '移動', value: calendarSummary.travelRequiredCount + '件', color: '#D97706', bg: '#FEF3C7' },
            { label: '期限', value: calendarSummary.deadlineRiskCount + '件', color: '#DC2626', bg: '#FEE2E2' },
          ].map((stat) => (
            <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: 4, background: stat.bg, borderRadius: 8, padding: '4px 8px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: stat.color }}>{stat.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: stat.color }}>{stat.value}</span>
            </div>
          ))}
        </div>
        {nextEventTime && nextEvent && (
          <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>
            次の予定：{nextEventTime} {nextEvent.summary}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: '#166534', fontWeight: 600 }}>
            予定変更なし · Google Calendar ReadOnly
          </span>
          <button
            onClick={() => onNavigate('cockpit')}
            style={{
              marginLeft: 'auto',
              background: '#166534',
              color: '#fff',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            全予定を見る →
          </button>
        </div>
      </div>

      {/* ── Drive ファイルカード（Phase 7） ── */}
      <div
        style={{
          background: '#FFFBEB',
          border: '1.5px solid #FDE68A',
          borderRadius: 'var(--radius)',
          padding: '14px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>📁</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#92400E' }}>
            最近の重要ファイル：{driveSummary.totalCount}件
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#B45309', fontWeight: 600 }}>
            デモDrive
          </span>
        </div>
        {latestModified && (
          <div style={{ fontSize: 11, color: '#B45309', marginBottom: 8 }}>
            最終更新：{latestModified}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[
            { label: '重要A', v: driveSummary.importanceACount, c: '#EF4444', bg: '#FEE2E2' },
            { label: '銀行', v: driveSummary.bankCount, c: '#1B3D6F', bg: '#DBEAFE' },
            { label: '請求', v: driveSummary.invoiceCount, c: '#D97706', bg: '#FEF3C7' },
            { label: '監査', v: driveSummary.auditCount, c: '#7C3AED', bg: '#EDE9FE' },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '3px 8px', display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.c }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.c }}>{s.v}件</span>
            </div>
          ))}
        </div>
        {latestFile && (
          <div style={{ fontSize: 12, color: '#92400E', fontWeight: 700, marginBottom: 8, wordBreak: 'break-all' }}>
            📄 {latestFile.name}
          </div>
        )}
        <button
          onClick={() => onNavigate('cockpit')}
          style={{
            background: '#F59E0B', color: '#fff', border: 'none',
            borderRadius: 8, padding: '7px 14px', fontSize: 12,
            fontWeight: 700, cursor: 'pointer', width: '100%',
          }}
        >
          全ファイルを見る →
        </button>
      </div>

      {/* ── BusinessData カード（Phase 8）── */}
      <div
        style={{
          background: '#F5F3FF',
          border: '1.5px solid #DDD6FE',
          borderRadius: 'var(--radius)',
          padding: '14px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#5B21B6' }}>
            経営数字：{mockBusinessDataset.metrics.length}指標
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6D28D9', fontWeight: 600 }}>
            デモSheets
          </span>
        </div>
        {businessRisks.length > 0 && (
          <div style={{ background: '#FEE2E2', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>
              🔴 要対応 {businessRisks.filter((r) => r.severity === 'critical' || r.severity === 'high').length}件
            </span>
            {businessRisks.slice(0, 2).map((r) => (
              <div key={r.metricId} style={{ fontSize: 11, color: '#991B1B', marginTop: 2 }}>
                • {r.description}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[
            { label: '粗利率', value: businessSummary.grossProfitRate !== null ? `${businessSummary.grossProfitRate}%` : '—', alert: (businessSummary.grossProfitRate ?? 100) < 30 },
            { label: '現金残高', value: businessSummary.cashBalance !== null ? `¥${((businessSummary.cashBalance ?? 0) / 10000).toFixed(0)}万` : '—', alert: (businessSummary.cashBalance ?? 999999999) < 5000000 },
            { label: '未請求', value: businessSummary.unbilledAmount !== null ? `¥${((businessSummary.unbilledAmount ?? 0) / 10000).toFixed(0)}万` : '—', alert: (businessSummary.unbilledAmount ?? 0) > 5000000 },
            { label: '未回収', value: businessSummary.uncollectedAmount !== null ? `¥${((businessSummary.uncollectedAmount ?? 0) / 10000).toFixed(0)}万` : '—', alert: (businessSummary.uncollectedAmount ?? 0) > 3000000 },
          ].map((s) => (
            <div key={s.label} style={{ background: s.alert ? '#FEE2E2' : '#EDE9FE', borderRadius: 8, padding: '3px 8px', display: 'flex', gap: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.alert ? '#DC2626' : '#5B21B6' }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.alert ? '#991B1B' : '#3B0764' }}>{s.value}</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => onNavigate('dashboard')}
          style={{
            background: '#7C3AED', color: '#fff', border: 'none',
            borderRadius: 8, padding: '7px 14px', fontSize: 12,
            fontWeight: 700, cursor: 'pointer', width: '100%',
          }}
        >
          経営数字を詳しく見る →
        </button>
      </div>

      {/* ── LINE WORKS 通知カード（Phase 9）── */}
      <div
        style={{
          background: '#F0FDFA',
          border: '1.5px solid #CCFBF1',
          borderRadius: 14,
          padding: '12px 14px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>💬</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0F766E' }}>
              LINE WORKS通知：{lwNotifications.length}件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ fontSize: 10, background: '#CCFBF1', color: '#0F766E', borderRadius: 999, padding: '2px 7px', fontWeight: 700 }}>
              デモ
            </span>
            <span style={{ fontSize: 10, background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontWeight: 700 }}>
              読み取り専用
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {[
            { label: `🚨 緊急 ${lwSummary.criticalCount}件`, show: lwSummary.criticalCount > 0, c: '#991B1B', bg: '#FEE2E2' },
            { label: `⚠️ 重要A ${lwSummary.highCount}件`, show: lwSummary.highCount > 0, c: '#92400E', bg: '#FEF3C7' },
            { label: `🚑 事故 ${lwSummary.accidentCount}件`, show: lwSummary.accidentCount > 0, c: '#991B1B', bg: '#FEE2E2' },
            { label: `SOS ${lwSummary.sosCount}件`, show: lwSummary.sosCount > 0, c: '#991B1B', bg: '#FEE2E2' },
          ].filter((s) => s.show).map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: '3px 8px' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: s.c }}>{s.label}</span>
            </div>
          ))}
        </div>
        {lwCritical.slice(0, 2).map((notif) => (
          <div key={notif.id} style={{ fontSize: 12, color: '#0F766E', fontWeight: 600, marginBottom: 4, padding: '4px 8px', background: '#fff', borderRadius: 6, border: '1px solid #CCFBF1' }}>
            🔴 {notif.title}
          </div>
        ))}
        <button
          onClick={() => onNavigate('actions')}
          style={{
            background: '#14B8A6', color: '#fff', border: 'none',
            borderRadius: 8, padding: '7px 14px', fontSize: 12,
            fontWeight: 700, cursor: 'pointer', width: '100%', marginTop: 6,
          }}
        >
          LINE WORKSの通知を確認する →
        </button>
      </div>

      {/* ── Gmail要対応サマリー ── */}
      <div
        style={{
          background: '#EFF6FF',
          border: '1.5px solid #BFDBFE',
          borderRadius: 14,
          padding: '12px 14px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>📧</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#1D4ED8' }}>
              Gmail由来の要対応：{gmailSummary.totalCount}件
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ background: '#DBEAFE', color: '#1D4ED8', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              デモGmail
            </span>
            <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 999, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              読み取り専用
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {[
            { label: '重要A', value: gmailSummary.priorityACount + '件', color: '#EF4444', bg: '#FEE2E2' },
            { label: '本日中', value: gmailSummary.todayDueCount + '件', color: '#DC2626', bg: '#FEE2E2' },
            { label: '銀行', value: gmailSummary.bankCount + '件', color: '#1B3D6F', bg: '#DBEAFE' },
            { label: '請求', value: gmailSummary.billingCount + '件', color: '#92400E', bg: '#FEF3C7' },
            { label: '契約', value: gmailSummary.contractCount + '件', color: '#7C3AED', bg: '#EDE9FE' },
            { label: '返信たたき台', value: gmailSummary.replyDraftCount + '件', color: '#065F46', bg: '#D1FAE5' },
          ].map((stat) => (
            <div key={stat.label} style={{ display: 'flex', alignItems: 'center', gap: 4, background: stat.bg, borderRadius: 8, padding: '4px 8px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: stat.color }}>{stat.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: stat.color }}>{stat.value}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#1D4ED8', fontWeight: 600 }}>
            本番Gmail未接続 · 返信未送信 · 社長承認待ち
          </span>
          <button
            onClick={() => onNavigate('actions')}
            style={{
              marginLeft: 'auto',
              background: '#1D4ED8',
              color: '#fff',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            要対応を見る →
          </button>
        </div>
      </div>

      {/* ── AIブリーフィングカード ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f2647 0%, #1B3D6F 60%, #2d5a9e 100%)',
          borderRadius: 20,
          padding: '18px',
          marginBottom: 14,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 背景円 */}
        <div
          style={{
            position: 'absolute',
            right: -30,
            top: -30,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 3 }}>
              {todayBriefing.date} — AI統合ブリーフィング（Phase 10）
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.4, whiteSpace: 'pre-line', marginBottom: 4 }}>
              {orchestratorResult.briefing.greeting}、社長
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.5, opacity: 0.95 }}>
              {orchestratorResult.briefing.headline}
            </div>
            {orchestratorResult.todayPlan.immediateActions.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <span style={{ background: 'rgba(16,185,129,0.7)', color: '#fff', borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 800 }}>
                  ⚡ 今すぐやること {orchestratorResult.todayPlan.immediateActions.length}件
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setBriefingExpanded(!briefingExpanded)}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 10,
            }}
          >
            {briefingExpanded ? '▲' : '▼'}
          </button>
        </div>

        {briefingExpanded && (
          <>
            {/* AI統合サマリー（Phase 10）*/}
            <div style={{ marginBottom: 12 }}>
              {orchestratorResult.briefing.summaryText.split('\n').filter(Boolean).map((line, i) => {
                const isDanger = line.includes('🚨') || line.includes('🔴')
                const isWarning = line.includes('⚠️') || line.includes('📊')
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '7px 10px',
                      borderRadius: 10,
                      background: isDanger
                        ? 'rgba(239,68,68,0.25)'
                        : isWarning
                          ? 'rgba(245,158,11,0.25)'
                          : 'rgba(255,255,255,0.12)',
                      marginBottom: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1.5,
                    }}
                  >
                    {line}
                  </div>
                )
              })}
            </div>

            {/* 今日フォーカス */}
            <div
              style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 12,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6, fontWeight: 700 }}>
                今日のフォーカス
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {orchestratorResult.briefing.todayFocusItems.map((item, i) => (
                  <span
                    key={i}
                    style={{
                      background: 'rgba(255,255,255,0.2)',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* AIコックピットへ */}
            <button
              onClick={() => onNavigate('cockpit')}
              style={{
                width: '100%',
                minHeight: 44,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.95)',
                color: '#1B3D6F',
                fontSize: 13,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginTop: 12,
                marginBottom: 8,
              }}
            >
              🎯 AIコックピットへ — 全状況を30秒で確認
            </button>

            {/* ボタン列 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => onNavigate('chat')}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.18)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                🤖 AIに相談
              </button>
              <button
                onClick={() => onNavigate('actions')}
                style={{
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 12,
                  background: 'rgba(239,68,68,0.7)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                ⚡ 要対応へ
              </button>
              <button
                onClick={onVoice}
                style={{
                  width: 40,
                  minHeight: 40,
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  fontSize: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                🎤
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── クイックアクション ── */}
      <div className="section-label">クイックアクション</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 4,
        }}
      >
        {quickCards.map((card) => (
          <button
            key={card.screen}
            onClick={() => onNavigate(card.screen)}
            style={{
              background: '#fff',
              borderRadius: 'var(--radius)',
              padding: '16px 14px',
              boxShadow: 'var(--shadow)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 6,
              position: 'relative',
              border: `2px solid ${card.color}15`,
              minHeight: 100,
            }}
          >
            {card.badge != null && (
              <span
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  background: card.color,
                  color: '#fff',
                  borderRadius: 999,
                  minWidth: 20,
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '0 5px',
                }}
              >
                {card.badge}
              </span>
            )}
            <span style={{ fontSize: 28 }}>{card.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: card.color }}>{card.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
              {card.sub}
            </span>
          </button>
        ))}
      </div>

      {/* ── 状況カード ── */}
      <div className="section-label">今日の状況</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 18,
        }}
      >
        {situationCards.map((card) => {
          const isDanger = card.alertLevel === 'danger'
          const isWarning = card.alertLevel === 'warning'
          const bg = isDanger
            ? 'var(--danger-light)'
            : isWarning
              ? 'var(--warning-light)'
              : '#fff'
          const border = isDanger
            ? '#FCA5A5'
            : isWarning
              ? '#FDE68A'
              : 'transparent'
          const valueColor = isDanger
            ? '#991B1B'
            : isWarning
              ? '#92400E'
              : 'var(--navy)'

          return (
            <button
              key={card.id}
              onClick={() => card.screen && onNavigate(card.screen)}
              style={{
                background: bg,
                border: `1.5px solid ${border}`,
                borderRadius: 14,
                padding: '12px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 4,
                boxShadow: 'var(--shadow)',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 20 }}>{card.icon}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.2 }}>
                {card.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: valueColor }}>
                {card.value}
              </div>
              {card.sub && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                  {card.sub}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* ── 業務ポータル ── */}
      <div className="section-label">業務ポータル</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'freee 会計', icon: '💹', tag: '連携予定' },
          { label: 'Google Drive', icon: '📁', tag: '連携予定' },
          { label: 'LINE WORKS', icon: '💬', tag: '連携予定' },
          { label: 'TKC', icon: '🏢', tag: '連携予定' },
        ].map((portal) => (
          <div
            key={portal.label}
            style={{
              background: '#fff',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: 'var(--shadow)',
            }}
          >
            <span style={{ fontSize: 22 }}>{portal.icon}</span>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{portal.label}</span>
            <span className="pill pill-planned">{portal.tag}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
