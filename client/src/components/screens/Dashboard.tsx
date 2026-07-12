import { useState, useMemo } from 'react'
import {
  dashboardMetrics,
  cashflowWeeks,
  projectMetrics,
  departmentMetrics,
} from '../../data/mockData'
import type { DashboardMetric, CashflowWeek, ProjectMetric } from '../../types'
import { mockBusinessDataset } from '../../services/sheets/mockSheets'
import { detectBusinessRisks } from '../../services/sheets/sheetsAnalyzer'
import DemoBanner from '../DemoBanner'
import { runOrchestrator } from '../../core/ai-engine/aiOrchestrator'
import { googleToken } from '../../services/google/googleToken'

const TODAY = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
const MAX_BALANCE = Math.max(...cashflowWeeks.map((w) => w.balance))
const businessRisks = detectBusinessRisks(mockBusinessDataset.metrics)

export default function Dashboard() {
  if (googleToken.hasToken()) {
    return <div className="screen-content"><DemoBanner /><div style={{background:'#fff',borderRadius:14,padding:18,boxShadow:'var(--shadow)'}}><h3 style={{margin:'0 0 8px'}}>経営データ未設定</h3><p style={{margin:0,color:'var(--text-muted)',lineHeight:1.7}}>Google認証は完了しています。対象スプレッドシートが未設定のため、売上・粗利・現金残高・健康度スコアは表示しません。架空データは使用していません。</p></div></div>
  }
  const [cfExpanded, setCfExpanded] = useState(true)
  const [projExpanded, setProjExpanded] = useState(true)
  const orchestratorResult = useMemo(() => runOrchestrator(), [])

  const normal = dashboardMetrics.filter((m) => !m.alert)
  const alerts = dashboardMetrics.filter((m) => m.alert)
  const health = orchestratorResult.healthScore

  const gradeColor = health.grade === 'A' ? '#065F46' : health.grade === 'B' ? '#1D4ED8' : health.grade === 'C' ? '#92400E' : '#991B1B'
  const gradeBg = health.grade === 'A' ? '#D1FAE5' : health.grade === 'B' ? '#DBEAFE' : health.grade === 'C' ? '#FEF3C7' : '#FEE2E2'
  const gradeBorder = health.grade === 'A' ? '#86EFAC' : health.grade === 'B' ? '#93C5FD' : health.grade === 'C' ? '#FDE68A' : '#FCA5A5'

  const categoryLabels: Record<string, string> = {
    cashflow: '現金残高', grossProfit: '粗利率', unbilled: '未請求', uncollected: '未回収',
    accident: '事故対応', personnel: '人員', sales: '売上', internalSOS: 'SOS通知', scheduleLoad: '予定負荷',
  }

  return (
    <div className="screen-content">
      <DemoBanner />

      {/* ── 会社健康度スコア（Phase 10）── */}
      <div
        style={{
          background: '#fff',
          border: `1.5px solid ${gradeBorder}`,
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          marginBottom: 14,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#4338CA', marginBottom: 2 }}>
              🤖 AI社長室 会社健康度スコア
            </div>
            <div style={{ fontSize: 10, color: '#6366F1', fontWeight: 600 }}>Phase 10 AI Engine · 全Provider横断 · 読み取り専用</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: gradeColor }}>{health.total}</div>
            <div
              style={{
                background: gradeBg,
                color: gradeColor,
                borderRadius: 8,
                padding: '2px 10px',
                fontSize: 13,
                fontWeight: 900,
                display: 'inline-block',
              }}
            >
              グレード {health.grade}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
          {(Object.entries(health.breakdown) as [string, { score: number; status: 'good' | 'warning' | 'danger'; comment: string }][]).map(([key, cat]) => (
            <div
              key={key}
              style={{
                background: cat.status === 'danger' ? '#FEF2F2' : cat.status === 'warning' ? '#FFFBEB' : '#F0FDF4',
                borderRadius: 8,
                padding: '6px 8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2 }}>{categoryLabels[key] ?? key}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: cat.status === 'danger' ? '#991B1B' : cat.status === 'warning' ? '#92400E' : '#065F46' }}>
                {cat.score}
              </div>
              <div style={{ fontSize: 9, color: cat.status === 'danger' ? '#EF4444' : cat.status === 'warning' ? '#F59E0B' : '#10B981', fontWeight: 700 }}>
                {cat.status === 'danger' ? '🔴' : cat.status === 'warning' ? '🟡' : '🟢'}
              </div>
            </div>
          ))}
        </div>

        {health.topRisks.length > 0 && (
          <div style={{ background: '#FEF2F2', borderRadius: 8, padding: '6px 10px', fontSize: 11, color: '#991B1B', fontWeight: 600 }}>
            ⚠️ 要注意: {health.topRisks.slice(0, 2).join(' · ')}
          </div>
        )}
      </div>

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

      {/* ── BusinessData Provider リスクサマリー（Phase 8）── */}
      {businessRisks.length > 0 && (
        <div
          style={{
            background: '#F5F3FF',
            border: '1.5px solid #DDD6FE',
            borderRadius: 'var(--radius)',
            padding: '12px 14px',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: '#5B21B6', marginBottom: 6 }}>
            📊 Sheets経営データ — {businessRisks.filter((r) => r.severity === 'critical' || r.severity === 'high').length}件要対応
            <span style={{ marginLeft: 8, fontSize: 10, color: '#6D28D9', fontWeight: 600 }}>デモSheets · 読み取り専用</span>
          </div>
          {businessRisks.slice(0, 3).map((r) => (
            <div key={r.metricId} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: r.severity === 'critical' ? '#DC2626' : '#D97706', fontWeight: 700, flexShrink: 0 }}>
                {r.severity === 'critical' ? '🔴' : '⚠️'}
              </span>
              <span style={{ fontSize: 11, color: '#3B0764' }}>{r.description}</span>
            </div>
          ))}
        </div>
      )}

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
        📌 Phase 8 — BusinessData Provider（デモSheets）由来のデータです。セル更新・行追加・削除は行っていません。freee / TKC 連携後にリアルタイム反映されます。
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
