import { useState, useMemo } from 'react'
import type { Screen } from '../../types'
import { actionItems, todayBriefing, situationCards, dashboardMetrics } from '../../data/mockData'
import DemoBanner from '../DemoBanner'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { createGmailSummary } from '../../services/gmail/gmailAnalyzer'
import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { createCalendarSummary } from '../../services/calendar/calendarAnalyzer'

interface Props {
  onNavigate: (screen: Screen) => void
  company?: string
  onVoice: () => void
}

const priorityACount = actionItems.filter((i) => i.priority === 'A' && !i.isRead).length
const alertMetrics = dashboardMetrics.filter((m) => m.alert).length

export default function Home({ onNavigate, onVoice }: Props) {
  const [briefingExpanded, setBriefingExpanded] = useState(true)
  const gmailSummary = useMemo(() => createGmailSummary(mockGmailMessages), [])
  const calendarSummary = useMemo(() => createCalendarSummary(mockCalendarEvents), [])
  const nextEvent = mockCalendarEvents.find((e) => e.status !== 'cancelled' && e.start.dateTime)
  const nextEventTime = nextEvent?.start.dateTime
    ? new Date(nextEvent.start.dateTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
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
          <div>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 3 }}>
              {todayBriefing.date} — 朝ブリーフィング
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, whiteSpace: 'pre-line' }}>
              {todayBriefing.greeting}
            </div>
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
            {/* 変化リスト */}
            <div style={{ marginBottom: 12 }}>
              {todayBriefing.changes.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 10,
                    background:
                      c.type === 'danger'
                        ? 'rgba(239,68,68,0.25)'
                        : c.type === 'warning'
                          ? 'rgba(245,158,11,0.25)'
                          : 'rgba(255,255,255,0.12)',
                    marginBottom: 5,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <span>{c.icon}</span>
                  <span>{c.text}</span>
                </div>
              ))}
            </div>

            {/* 今日最初にやること */}
            <div
              style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 12,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6, fontWeight: 700 }}>
                今日最初にやること
              </div>
              {todayBriefing.topActions.map((a, i) => (
                <div
                  key={i}
                  style={{ fontSize: 13, opacity: 0.92, padding: '3px 0', display: 'flex', gap: 6 }}
                >
                  <span style={{ opacity: 0.6 }}>{i + 1}.</span>
                  <span>{a}</span>
                </div>
              ))}
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
