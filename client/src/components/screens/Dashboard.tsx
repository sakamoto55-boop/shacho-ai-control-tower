import { useState } from 'react'
import {
  dashboardMetrics,
  cashflowWeeks,
  projectMetrics,
  departmentMetrics,
} from '../../data/mockData'
import type { DashboardMetric, CashflowWeek, ProjectMetric } from '../../types'
import DemoBanner from '../DemoBanner'

const TODAY = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
const MAX_BALANCE = Math.max(...cashflowWeeks.map((w) => w.balance))

export default function Dashboard() {
  const [cfExpanded, setCfExpanded] = useState(true)
  const [projExpanded, setProjExpanded] = useState(true)

  const normal = dashboardMetrics.filter((m) => !m.alert)
  const alerts = dashboardMetrics.filter((m) => m.alert)

  return (
    <div className="screen-content">
      <DemoBanner />
      {/* ── 月次サマリー ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)',
          borderRadius: 'var(--radius)',
          padding: '16px 18px',
          marginBottom: 14,
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{TODAY} 経営サマリー</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { label: '売上', value: '¥28.4M', sub: '+12%' },
            { label: '粗利', value: '¥8.1M', sub: '28.6%' },
            { label: '現金残高', value: '¥4.2M', sub: '⚠️ 注意', alert: true },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{s.value}</div>
              <div
                style={{
                  fontSize: 10,
                  color: s.alert ? '#FCA5A5' : 'rgba(255,255,255,0.65)',
                  fontWeight: s.alert ? 700 : 400,
                }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 要注意項目 ── */}
      <div className="section-label" style={{ color: '#EF4444' }}>⚠️ 要注意項目</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {alerts.map((m) => (
          <AlertCard key={m.id} metric={m} />
        ))}
      </div>

      {/* ── 13週資金繰り ── */}
      <button
        onClick={() => setCfExpanded(!cfExpanded)}
        style={{
          width: '100%',
          background: '#fff',
          borderRadius: cfExpanded ? '16px 16px 0 0' : 16,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 14,
          fontWeight: 800,
          color: 'var(--navy)',
          boxShadow: 'var(--shadow)',
          borderBottom: cfExpanded ? '1px solid var(--border)' : 'none',
        }}
      >
        <span>📅 13週資金繰り予測</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              background: '#FEE2E2',
              color: '#B91C1C',
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            注意 3週
          </span>
          <span style={{ color: 'var(--text-muted)' }}>{cfExpanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {cfExpanded && (
        <div
          style={{
            background: '#fff',
            borderRadius: '0 0 16px 16px',
            boxShadow: 'var(--shadow)',
            overflow: 'hidden',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              padding: '14px 12px',
            }}
          >
            <div style={{ display: 'flex', gap: 8, minWidth: 'max-content' }}>
              {cashflowWeeks.map((w) => (
                <CashflowBar key={w.week} week={w} max={MAX_BALANCE} />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                marginTop: 10,
                fontSize: 11,
                color: 'var(--text-muted)',
                padding: '0 4px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: '#3B82F6',
                    borderRadius: 2,
                    display: 'inline-block',
                  }}
                />
                入金
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: '#E2E8F0',
                    borderRadius: 2,
                    display: 'inline-block',
                  }}
                />
                支出
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: '#10B981',
                    borderRadius: 2,
                    display: 'inline-block',
                  }}
                />
                残高
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 案件粗利ランキング ── */}
      <button
        onClick={() => setProjExpanded(!projExpanded)}
        style={{
          width: '100%',
          background: '#fff',
          borderRadius: projExpanded ? '16px 16px 0 0' : 16,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 14,
          fontWeight: 800,
          color: 'var(--navy)',
          boxShadow: 'var(--shadow)',
          borderBottom: projExpanded ? '1px solid var(--border)' : 'none',
        }}
      >
        <span>🏆 案件粗利ランキング</span>
        <span style={{ color: 'var(--text-muted)' }}>{projExpanded ? '▲' : '▼'}</span>
      </button>

      {projExpanded && (
        <div
          style={{
            background: '#fff',
            borderRadius: '0 0 16px 16px',
            boxShadow: 'var(--shadow)',
            overflow: 'hidden',
            marginBottom: 14,
          }}
        >
          {projectMetrics.map((p, i) => (
            <ProjectRow key={p.id} project={p} rank={i + 1} last={i === projectMetrics.length - 1} />
          ))}
        </div>
      )}

      {/* ── 部署別利益 ── */}
      <div className="section-label">部署別利益</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {departmentMetrics.map((d) => (
          <div
            key={d.id}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '12px 16px',
              boxShadow: 'var(--shadow)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                {d.name}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                <span>売上 ¥{(d.revenue / 1000000).toFixed(1)}M</span>
                <span>利益 ¥{(d.profit / 1000000).toFixed(1)}M</span>
              </div>
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: d.profitRate >= 28 ? '#10B981' : d.profitRate >= 22 ? '#F59E0B' : '#EF4444',
              }}
            >
              {d.profitRate}%
            </div>
          </div>
        ))}
      </div>

      {/* ── 財務指標グリッド ── */}
      <div className="section-label">財務指標</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {normal.map((m) => (
          <MetricCard key={m.id} metric={m} />
        ))}
      </div>

      {/* 注記 */}
      <div
        style={{
          padding: '12px 14px',
          background: '#fff',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
          marginBottom: 8,
        }}
      >
        📌 数値はすべて仮データです。freee / Google Sheets / TKC 連携後にリアルタイム反映されます。既存データへの書き込みは行っていません。
      </div>
    </div>
  )
}

function CashflowBar({ week, max }: { week: CashflowWeek; max: number }) {
  const BAR_HEIGHT = 80
  const incomeH = (week.income / max) * BAR_HEIGHT
  const expenseH = (week.expense / max) * BAR_HEIGHT
  const balanceH = (week.balance / max) * BAR_HEIGHT

  const alertColor =
    week.alertLevel === 'danger'
      ? '#EF4444'
      : week.alertLevel === 'warning'
        ? '#F59E0B'
        : 'transparent'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        minWidth: 52,
      }}
    >
      {/* バー群 */}
      <div
        style={{
          display: 'flex',
          gap: 3,
          alignItems: 'flex-end',
          height: BAR_HEIGHT,
          padding: '0 4px',
          background: week.alert ? alertColor + '15' : 'transparent',
          borderRadius: 6,
          border: week.alert ? `1.5px solid ${alertColor}` : '1.5px solid transparent',
        }}
      >
        <div style={{ width: 10, height: incomeH, background: '#3B82F6', borderRadius: '3px 3px 0 0' }} />
        <div style={{ width: 10, height: expenseH, background: '#E2E8F0', borderRadius: '3px 3px 0 0' }} />
        <div style={{ width: 10, height: balanceH, background: '#10B981', borderRadius: '3px 3px 0 0' }} />
      </div>

      {/* ラベル */}
      <div
        style={{
          fontSize: 9,
          color: week.alert ? alertColor : 'var(--text-muted)',
          fontWeight: week.alert ? 800 : 600,
          textAlign: 'center',
        }}
      >
        {week.week}
      </div>
      <div
        style={{
          fontSize: 9,
          color: week.alert ? alertColor : 'var(--text-secondary)',
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {week.balance}万
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  rank,
  last,
}: {
  project: ProjectMetric
  rank: number
  last: boolean
}) {
  const isAlert = project.alert
  const rateColor =
    project.grossProfitRate >= 30
      ? '#10B981'
      : project.grossProfitRate >= 24
        ? '#F59E0B'
        : '#EF4444'

  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: isAlert ? '#FFF8F8' : '#fff',
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background:
            rank === 1 ? '#F59E0B' : rank === 2 ? '#94A3B8' : rank === 3 ? '#D97706' : '#E2E8F0',
          color: rank <= 3 ? '#fff' : 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.name}
          {isAlert && <span style={{ marginLeft: 5, fontSize: 11, color: '#EF4444' }}>⚠️</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {project.client} · {project.status}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: rateColor }}>
          {project.grossProfitRate}%
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ¥{(project.grossProfit / 10000).toFixed(0)}万
        </div>
      </div>
    </div>
  )
}

function MetricCard({ metric }: { metric: DashboardMetric }) {
  const trendIcon = metric.trend === 'up' ? '↑' : metric.trend === 'down' ? '↓' : '→'
  const trendColor =
    metric.trend === 'up' ? '#10B981' : metric.trend === 'down' ? '#EF4444' : '#64748B'

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 'var(--radius)',
        padding: '14px 14px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          marginBottom: 5,
          fontWeight: 600,
        }}
      >
        {metric.label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--navy)', marginBottom: 3 }}>
        {metric.value}
      </div>
      {metric.subValue && (
        <div
          style={{
            fontSize: 11,
            color: trendColor,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span>{trendIcon}</span>
          <span>{metric.subValue}</span>
        </div>
      )}
    </div>
  )
}

function AlertCard({ metric }: { metric: DashboardMetric }) {
  const isDanger = metric.alertLevel === 'danger'
  const bg = isDanger ? '#FEF2F2' : '#FFFBEB'
  const border = isDanger ? '#FCA5A5' : '#FDE68A'
  const color = isDanger ? '#991B1B' : '#92400E'
  const icon = isDanger ? '🔴' : '🟡'

  return (
    <div
      style={{
        background: bg,
        border: `1.5px solid ${border}`,
        borderRadius: 'var(--radius)',
        padding: '13px 15px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 2 }}>
          {metric.label}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>
          {metric.value}
        </div>
        {metric.subValue && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{metric.subValue}</div>
        )}
      </div>
    </div>
  )
}
