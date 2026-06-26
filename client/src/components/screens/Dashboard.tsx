import { dashboardMetrics } from '../../data/mockData'
import type { DashboardMetric } from '../../types'

const TODAY = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })

export default function Dashboard() {
  const normal = dashboardMetrics.filter((m) => !m.alert)
  const alerts = dashboardMetrics.filter((m) => m.alert)

  return (
    <div className="screen-content">
      {/* 月次サマリーバー */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)',
          borderRadius: 'var(--radius)',
          padding: '16px 18px',
          marginBottom: 18,
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{TODAY} 経営サマリー</div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>売上</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>¥28.4M</div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 20 }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>粗利</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>¥8.1M</div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 20 }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>粗利率</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>28.6%</div>
          </div>
        </div>
      </div>

      {/* 注意・アラート */}
      <div className="section-label" style={{ color: '#EF4444' }}>
        ⚠️ 要注意項目
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {alerts.map((m) => (
          <AlertCard key={m.id} metric={m} />
        ))}
      </div>

      {/* 通常指標 */}
      <div className="section-label">財務指標</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 20,
        }}
      >
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
        📌 数値は仮データです。freee / Google Sheets との連携後にリアルタイム反映されます。
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
        padding: '16px 14px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
        {metric.label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', marginBottom: 4 }}>
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
            gap: 3,
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
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color, marginBottom: 3 }}>
          {metric.label}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 3 }}>
          {metric.value}
        </div>
        {metric.subValue && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{metric.subValue}</div>
        )}
      </div>
    </div>
  )
}
