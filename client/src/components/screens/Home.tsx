import type { Screen } from '../../types'
import { mockActionItems, dashboardMetrics } from '../../data/mockData'

interface Props {
  onNavigate: (screen: Screen) => void
  company: string
}

const priorityACount = mockActionItems.filter((i) => i.priority === 'A' && !i.isRead).length
const alertCount = dashboardMetrics.filter((m) => m.alert).length

export default function Home({ onNavigate, company }: Props) {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })

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
      sub: `注意項目: ${alertCount}件`,
      color: '#2d5a9e',
      badge: alertCount > 0 ? alertCount : null,
    },
  ]

  return (
    <div className="screen-content">
      {/* 挨拶カード */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 18px',
          marginBottom: 18,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -20,
            top: -20,
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
          }}
        />
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{today}</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
          おはようございます 👋
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
          {company} の管制塔です。
          <br />
          今日も一日、サポートします。
        </div>
        {priorityACount > 0 && (
          <div
            style={{
              marginTop: 14,
              background: 'rgba(239,68,68,0.9)',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 13,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>🔴</span> 優先度A が {priorityACount}件あります
          </div>
        )}
      </div>

      {/* クイックアクション */}
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
            {card.badge && (
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
            <span style={{ fontSize: 14, fontWeight: 800, color: card.color }}>
              {card.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
              {card.sub}
            </span>
          </button>
        ))}
      </div>

      {/* 業務ポータル */}
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
            <span style={{ fontSize: 24 }}>{portal.icon}</span>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{portal.label}</span>
            <span className="pill pill-planned">{portal.tag}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
