import { useState, useMemo } from 'react'
import type { PriorityAction, ActionSuggestion, TimelinePeriod } from '../../types'
import {
  companyHealthScore,
  priorityActions,
  timelinePeriods,
  aiJudgement,
  searchIndex,
} from '../../data/mockData'
import DemoBanner from '../DemoBanner'

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

export default function CockpitScreen() {
  const [expandedActionId, setExpandedActionId] = useState<string | null>('pa1')
  const [activeSuggestion, setActiveSuggestion] = useState<ActionSuggestion | null>(null)
  const [activeTimeline, setActiveTimeline] = useState<TimelinePeriod>('today')
  const [searchQuery, setSearchQuery] = useState('')
  const [healthExpanded, setHealthExpanded] = useState(true)

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

      {/* ── AI判断一言 ── */}
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
          🤖 AIからの一言 — {aiJudgement.generatedAt}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.6, marginBottom: 10 }}>
          {aiJudgement.message}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {aiJudgement.focusItems.map((item, i) => (
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

      {/* ── 今日の優先順位 TOP5 ── */}
      <div className="section-label">🎯 今日の優先順位 TOP 5</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {priorityActions.map((action) => (
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
            marginBottom: 20,
          }}
        >
          💡 「加藤」「銀行」「未請求」「事故」「お結び」「車両」などで検索できます。
          Gmail・LINE WORKS連携後はリアルタイムデータが表示されます。
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
