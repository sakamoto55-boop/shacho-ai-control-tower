import { useState } from 'react'
import { companies, connections, apiIntegrationPoints } from '../../data/mockData'

interface Props {
  company: string
  onCompanyChange: (id: string) => void
}

const ROLES = ['社長専用', '管理者', '事務', '現場']

export default function Settings({ company, onCompanyChange }: Props) {
  const [activeRole, setActiveRole] = useState('社長専用')
  const [showApiPoints, setShowApiPoints] = useState(false)

  const selectedCompany = companies.find((c) => c.id === company)

  return (
    <div className="screen-content">
      {/* 会社選択 */}
      <div className="section-label">会社選択</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {companies.map((c) => (
          <button
            key={c.id}
            onClick={() => onCompanyChange(c.id)}
            style={{
              background: company === c.id ? 'var(--navy)' : '#fff',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: 'var(--shadow)',
              border: company === c.id ? '2px solid var(--navy)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: company === c.id ? 'rgba(255,255,255,0.2)' : 'var(--blue-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 800,
                color: company === c.id ? '#fff' : 'var(--navy)',
                flexShrink: 0,
              }}
            >
              {c.shortName.slice(0, 2)}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: company === c.id ? '#fff' : 'var(--text-primary)',
                textAlign: 'left',
                flex: 1,
              }}
            >
              {c.name}
            </span>
            {company === c.id && (
              <span style={{ color: '#fff', fontSize: 18 }}>✓</span>
            )}
          </button>
        ))}
      </div>

      {/* 権限区分 */}
      <div className="section-label">権限区分</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 20,
        }}
      >
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => setActiveRole(role)}
            style={{
              background: activeRole === role ? 'var(--navy)' : '#fff',
              color: activeRole === role ? '#fff' : 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              fontSize: 14,
              fontWeight: 700,
              boxShadow: 'var(--shadow)',
              border: activeRole === role ? '2px solid var(--navy)' : '2px solid transparent',
            }}
          >
            {role}
          </button>
        ))}
      </div>

      {/* 接続設定 */}
      <div className="section-label">連携サービス</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {connections.map((conn) => (
          <div
            key={conn.id}
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
            <span style={{ fontSize: 22 }}>{conn.icon}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{conn.name}</span>
            <span
              className={`pill ${conn.status === 'connected' ? 'pill-connected' : 'pill-planned'}`}
            >
              {conn.status === 'connected' ? '接続中' : '連携予定'}
            </span>
          </div>
        ))}
      </div>

      {/* API連携ポイント（開発者向け） */}
      <button
        onClick={() => setShowApiPoints(!showApiPoints)}
        style={{
          width: '100%',
          background: '#fff',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--text-secondary)',
          boxShadow: 'var(--shadow)',
          marginBottom: 8,
        }}
      >
        <span>🔧 API連携ポイント一覧（開発者向け）</span>
        <span>{showApiPoints ? '▲' : '▼'}</span>
      </button>

      {showApiPoints && (
        <div
          style={{
            background: '#1E293B',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            marginBottom: 20,
          }}
        >
          {apiIntegrationPoints.map((point, i) => (
            <div
              key={i}
              style={{
                marginBottom: i < apiIntegrationPoints.length - 1 ? 14 : 0,
                paddingBottom: i < apiIntegrationPoints.length - 1 ? 14 : 0,
                borderBottom:
                  i < apiIntegrationPoints.length - 1 ? '1px solid #334155' : 'none',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: '#93C5FD', marginBottom: 3 }}>
                {point.feature}
              </div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontFamily: 'monospace', marginBottom: 2 }}>
                {point.endpoint}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {point.provider} — {point.note}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* バージョン情報 */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--text-muted)',
          padding: '8px 0 4px',
        }}
      >
        AI社長室 v0.1.0 MVP — {selectedCompany?.name}
        <br />
        Phase 1: フロントエンドMVP（仮データ）
      </div>
    </div>
  )
}
