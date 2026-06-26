import { useState } from 'react'
import type { ActionItem, Priority } from '../../types'
import { mockActionItems } from '../../data/mockData'

const SECTIONS: { priority: Priority; label: string; icon: string; color: string }[] = [
  { priority: 'A', label: '優先度A ― 今日必ず対応', icon: '🔴', color: '#EF4444' },
  { priority: 'B', label: '優先度B ― 今週中に対応', icon: '🟡', color: '#F59E0B' },
  { priority: 'waiting-confirm', label: '確認待ち', icon: '🔵', color: '#3B82F6' },
  { priority: 'waiting-create', label: '作成待ち', icon: '⚪', color: '#64748B' },
]

export default function TodayActions() {
  const [expanded, setExpanded] = useState<Priority>('A')
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())

  function toggleDone(id: string) {
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="screen-content">
      {SECTIONS.map((sec) => {
        const items = mockActionItems.filter((i) => i.priority === sec.priority)
        const isOpen = expanded === sec.priority
        const doneCount = items.filter((i) => doneIds.has(i.id)).length

        return (
          <div key={sec.priority} style={{ marginBottom: 12 }}>
            {/* セクションヘッダー */}
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
              <span style={{ flex: 1, fontWeight: 800, fontSize: 14, textAlign: 'left', color: sec.color }}>
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
              <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 4 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </button>

            {/* アイテムリスト */}
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
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ActionCard({
  item,
  accentColor,
  done,
  onToggleDone,
  last,
}: {
  item: ActionItem
  accentColor: string
  done: boolean
  onToggleDone: () => void
  last: boolean
}) {
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
          {/* カテゴリタグ + 件名 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span
              style={{
                background: accentColor + '18',
                color: accentColor,
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {item.category}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: done ? 'var(--text-muted)' : 'var(--text-primary)',
                textDecoration: done ? 'line-through' : 'none',
                lineHeight: 1.4,
              }}
            >
              {item.subject}
            </span>
          </div>

          {/* 詳細情報 */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            <span>👤 {item.from}</span>
            <span>⏰ {item.deadline}</span>
          </div>

          {/* 推奨アクション */}
          <div
            style={{
              marginTop: 8,
              background: accentColor + '0d',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: accentColor,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span>→</span>
            <span>推奨アクション: {item.action}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
