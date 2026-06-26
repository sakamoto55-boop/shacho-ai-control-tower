import { useState } from 'react'
import type { ActionItem, Priority } from '../../types'
import { actionItems } from '../../data/mockData'
import DemoBanner from '../DemoBanner'

const SECTIONS: { priority: Priority; label: string; icon: string; color: string }[] = [
  { priority: 'A', label: '優先度A ― 今日必ず対応', icon: '🔴', color: '#EF4444' },
  { priority: 'B', label: '優先度B ― 今週中に対応', icon: '🟡', color: '#F59E0B' },
  { priority: 'waiting-confirm', label: '確認待ち', icon: '🔵', color: '#3B82F6' },
  { priority: 'waiting-create', label: '作成待ち', icon: '⚪', color: '#64748B' },
]

const TYPE_COLORS: Record<string, string> = {
  'メール': '#3B82F6',
  'LINE WORKS': '#10B981',
  '承認': '#7C3AED',
  '契約': '#DB2777',
  '請求': '#F59E0B',
  '現場': '#D97706',
  '事故': '#EF4444',
  '銀行': '#1B3D6F',
  '福祉': '#DB2777',
}

const STATUS_CONFIG: Record<string, { bg: string; color: string }> = {
  '未対応': { bg: '#FEF2F2', color: '#991B1B' },
  '対応中': { bg: '#FFF7ED', color: '#C2410C' },
  '確認中': { bg: '#EFF6FF', color: '#1D4ED8' },
  '完了': { bg: '#ECFDF5', color: '#065F46' },
}

export default function TodayActions() {
  const [expanded, setExpanded] = useState<Priority>('A')
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [selectedItem, setSelectedItem] = useState<ActionItem | null>(null)

  function toggleDone(id: string) {
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="screen-content">
        <DemoBanner />
        {SECTIONS.map((sec) => {
          const items = actionItems.filter((i) => i.priority === sec.priority)
          const isOpen = expanded === sec.priority
          const doneCount = items.filter((i) => doneIds.has(i.id)).length

          return (
            <div key={sec.priority} style={{ marginBottom: 12 }}>
              <button
                onClick={() => setExpanded(isOpen ? ('' as Priority) : sec.priority)}
                style={{
                  width: '100%',
                  background: '#fff',
                  borderRadius: isOpen ? '16px 16px 0 0' : 16,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: 'var(--shadow)',
                  borderBottom: isOpen ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 18 }}>{sec.icon}</span>
                <span
                  style={{
                    flex: 1,
                    fontWeight: 800,
                    fontSize: 14,
                    textAlign: 'left',
                    color: sec.color,
                  }}
                >
                  {sec.label}
                </span>
                <span
                  style={{
                    background: sec.color + '20',
                    color: sec.color,
                    borderRadius: 999,
                    padding: '3px 10px',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {doneCount}/{items.length}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>

              {isOpen && (
                <div
                  style={{
                    background: '#fff',
                    borderRadius: '0 0 16px 16px',
                    boxShadow: 'var(--shadow)',
                    overflow: 'hidden',
                  }}
                >
                  {items.map((item, idx) => (
                    <ActionCard
                      key={item.id}
                      item={item}
                      accentColor={sec.color}
                      done={doneIds.has(item.id)}
                      onToggleDone={() => toggleDone(item.id)}
                      last={idx === items.length - 1}
                      onDetail={() => setSelectedItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 詳細モーダル */}
      {selectedItem && (
        <TaskDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </>
  )
}

function ActionCard({
  item,
  accentColor,
  done,
  onToggleDone,
  last,
  onDetail,
}: {
  item: ActionItem
  accentColor: string
  done: boolean
  onToggleDone: () => void
  last: boolean
  onDetail: () => void
}) {
  const typeColor = TYPE_COLORS[item.type] ?? '#64748B'
  const statusStyle = STATUS_CONFIG[item.status] ?? STATUS_CONFIG['未対応']

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        opacity: done ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* チェックボックス */}
        <button
          onClick={onToggleDone}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: `2px solid ${done ? accentColor : 'var(--border)'}`,
            background: done ? accentColor : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 2,
            fontSize: 12,
            color: '#fff',
            transition: 'all 0.2s',
          }}
        >
          {done ? '✓' : ''}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* バッジ行 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginBottom: 5,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                background: typeColor + '18',
                color: typeColor,
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {item.type}
            </span>
            <span
              style={{
                background: statusStyle.bg,
                color: statusStyle.color,
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {item.status}
            </span>
            {item.importance === 'high' && (
              <span
                style={{
                  background: '#FEE2E2',
                  color: '#B91C1C',
                  borderRadius: 6,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                重要
              </span>
            )}
          </div>

          {/* 件名 */}
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: done ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: done ? 'line-through' : 'none',
              lineHeight: 1.4,
              marginBottom: 5,
            }}
          >
            {item.subject}
          </div>

          {/* 詳細情報 */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '3px 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 8,
            }}
          >
            <span>👤 {item.from}</span>
            <span>⏰ {item.deadline}</span>
          </div>

          {/* 推奨アクション */}
          <div
            style={{
              background: accentColor + '0d',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: accentColor,
              marginBottom: 8,
            }}
          >
            → 推奨: {item.action}
          </div>

          {/* 詳細ボタン */}
          <button
            onClick={onDetail}
            style={{
              background: 'var(--blue-light)',
              color: 'var(--navy)',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            📋 詳細・返信文を見る
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskDetailModal({ item, onClose }: { item: ActionItem; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'reply' | 'next'>('overview')
  const typeColor = TYPE_COLORS[item.type] ?? '#64748B'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
          background: '#fff',
          borderRadius: '24px 24px 0 0',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ハンドル + ヘッダー */}
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div
            style={{
              width: 40,
              height: 4,
              background: '#E2E8F0',
              borderRadius: 4,
              margin: '0 auto 14px',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: typeColor + '18',
                    color: typeColor,
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {item.type}
                </span>
                <span
                  style={{
                    background: '#FEE2E2',
                    color: '#B91C1C',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  ⏰ {item.deadline}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: 'var(--text-primary)' }}>
                {item.subject}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                👤 {item.from}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--bg)',
                color: 'var(--text-secondary)',
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* タブ */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {(
              [
                { key: 'overview', label: '概要・背景' },
                { key: 'reply', label: '返信文たたき台' },
                { key: 'next', label: '次のアクション' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: tab === t.key ? 'var(--navy)' : 'var(--text-muted)',
                  borderBottom: tab === t.key ? '2px solid var(--navy)' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* コンテンツ */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)',
            scrollbarWidth: 'none',
          }}
        >
          {tab === 'overview' && (
            <div>
              <Section title="要約" icon="📋">
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>
                  {item.detail.summary}
                </p>
              </Section>
              <Section title="背景・経緯" icon="🕐">
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>
                  {item.detail.background}
                </p>
              </Section>
              <Section title="推奨アクション" icon="✅">
                {item.detail.recommendedActions.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginBottom: 6,
                      fontSize: 14,
                      color: 'var(--text-primary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: 'var(--navy)', fontWeight: 700, flexShrink: 0 }}>
                      {i + 1}.
                    </span>
                    <span>{a}</span>
                  </div>
                ))}
              </Section>
              {item.detail.relatedData.length > 0 && (
                <Section title="関連データ" icon="📊">
                  {item.detail.relatedData.map((d, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'var(--blue-light)',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: 12,
                        color: 'var(--navy)',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      {d}
                    </div>
                  ))}
                </Section>
              )}
            </div>
          )}

          {tab === 'reply' && (
            <div>
              {item.detail.replyDraft ? (
                <>
                  <div
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid var(--border)',
                      borderRadius: 14,
                      padding: '16px',
                      fontSize: 14,
                      lineHeight: 1.8,
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                      marginBottom: 14,
                    }}
                  >
                    {item.detail.replyDraft}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <button
                      onClick={() => navigator.clipboard?.writeText(item.detail.replyDraft)}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 12,
                        background: 'var(--navy)',
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      📋 コピー
                    </button>
                    <button
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 12,
                        background: 'var(--bg)',
                        color: 'var(--text-secondary)',
                        fontSize: 13,
                        fontWeight: 700,
                        border: '1px solid var(--border)',
                      }}
                    >
                      📧 Gmail下書き予定
                    </button>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                    }}
                  >
                    ※ Gmail連携後は自動で下書きに保存できます
                  </div>
                </>
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '32px 16px',
                    color: 'var(--text-muted)',
                    fontSize: 14,
                  }}
                >
                  このタスクには返信文は不要です
                </div>
              )}
            </div>
          )}

          {tab === 'next' && (
            <div>
              <Section title="次にやること" icon="📌">
                {item.detail.nextSteps.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      marginBottom: 10,
                      padding: '10px 12px',
                      background: '#fff',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'var(--blue-light)',
                        color: 'var(--navy)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </div>
                    <span style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {s}
                    </span>
                  </div>
                ))}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: 'var(--text-secondary)',
          letterSpacing: '0.05em',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span>{icon}</span> {title}
      </div>
      {children}
    </div>
  )
}
