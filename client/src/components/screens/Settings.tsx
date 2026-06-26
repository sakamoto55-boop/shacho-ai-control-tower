import { useState } from 'react'
import { companies, integrations, apiIntegrationPoints } from '../../data/mockData'

interface Props {
  company: string
  onCompanyChange: (id: string) => void
}

const ROLES = ['社長専用', '管理者', '事務', '現場']

const INTEGRATION_PHASES = [
  { phase: 1, label: 'Gmail読み取り', status: '未接続' },
  { phase: 2, label: 'Googleカレンダー読み取り', status: '未接続' },
  { phase: 3, label: 'Google Drive検索', status: '未接続' },
  { phase: 4, label: 'Googleスプレッドシート読み取り', status: '未接続' },
  { phase: 5, label: 'LINE WORKS通知', status: '未接続' },
  { phase: 6, label: 'Gmail下書き作成', status: '計画中' },
  { phase: 7, label: 'Google Drive保存', status: '計画中' },
  { phase: 8, label: '各種書き込み処理', status: '将来' },
]

export default function Settings({ company, onCompanyChange }: Props) {
  const [activeRole, setActiveRole] = useState('社長専用')
  const [showApiPoints, setShowApiPoints] = useState(false)
  const [showPhaseRoadmap, setShowPhaseRoadmap] = useState(false)

  const selectedCompany = companies.find((c) => c.id === company)

  return (
    <div className="screen-content">
      {/* ── デモモード表示 ── */}
      <div
        style={{
          background: '#FEF9C3',
          border: '1px solid #FDE68A',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 18,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: '#92400E', marginBottom: 10 }}>
          ⚠️ 動作モード設定
        </div>
        {[
          { label: 'デモモード',     value: 'ON',  on: true },
          { label: '本番準備モード', value: 'OFF', on: false },
          { label: '外部接続',       value: '未接続', on: false },
          { label: '読み取り専用予定', value: 'ON', on: true },
          { label: '書き込み禁止',   value: 'ON',  on: true },
        ].map((row) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid #FDE68A44',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>{row.label}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: row.on ? '#065F46' : '#991B1B',
                background: row.on ? '#D1FAE5' : '#FEE2E2',
                borderRadius: 6,
                padding: '2px 8px',
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── データ連携ステータス ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)',
          borderRadius: 'var(--radius)',
          padding: '16px',
          marginBottom: 18,
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>データ連携ステータス</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <StatusBadge icon="🔒" label="読み取り専用" active />
          <StatusBadge icon="🚫" label="書き込み禁止" active />
          <StatusBadge icon="📡" label="外部接続" inactive label2="未接続" />
        </div>
        <div style={{ fontSize: 11, opacity: 0.65, marginTop: 10, lineHeight: 1.6 }}>
          現在はフロントエンドMVPです。すべての外部サービスへの書き込みは行っていません。既存のGmail・Drive・スプレッドシート・LINE WORKSのデータは変更されていません。
        </div>
      </div>

      {/* ── 会社選択 ── */}
      <div className="section-label">会社選択</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
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
                fontSize: 12,
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
                flex: 1,
                textAlign: 'left',
              }}
            >
              {c.name}
            </span>
            {company === c.id && <span style={{ color: '#fff', fontSize: 18 }}>✓</span>}
          </button>
        ))}
      </div>

      {/* ── 権限区分 ── */}
      <div className="section-label">権限区分</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
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

      {/* ── 連携サービス ── */}
      <div className="section-label">連携サービス</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {integrations.map((conn) => (
          <div
            key={conn.id}
            style={{
              background: '#fff',
              borderRadius: 'var(--radius-sm)',
              padding: '13px 16px',
              boxShadow: 'var(--shadow)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{conn.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{conn.name}</span>
                  <span
                    style={{
                      background: '#FEF3C7',
                      color: '#92400E',
                      borderRadius: 999,
                      padding: '2px 7px',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    未接続
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#3B82F6', fontWeight: 600 }}>
                  {conn.readMode}
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: 7,
                padding: '6px 10px',
                background: 'var(--bg)',
                borderRadius: 8,
                fontSize: 11,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              {conn.note}
            </div>
          </div>
        ))}
      </div>

      {/* 最終同期日時 */}
      <div
        style={{
          padding: '12px 14px',
          background: '#fff',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 18,
          boxShadow: 'var(--shadow)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>最終データ同期</span>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
          未接続（連携後に表示）
        </span>
      </div>

      {/* ── 接続ロードマップ ── */}
      <button
        onClick={() => setShowPhaseRoadmap(!showPhaseRoadmap)}
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
          color: 'var(--navy)',
          boxShadow: 'var(--shadow)',
          marginBottom: 8,
        }}
      >
        <span>🗺️ 接続予定ロードマップ</span>
        <span>{showPhaseRoadmap ? '▲' : '▼'}</span>
      </button>

      {showPhaseRoadmap && (
        <div style={{ background: '#fff', borderRadius: 'var(--radius-sm)', padding: '14px', marginBottom: 14, boxShadow: 'var(--shadow)' }}>
          {INTEGRATION_PHASES.map((p, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: i < INTEGRATION_PHASES.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: p.status === '未接続' ? 'var(--bg)' : p.status === '計画中' ? 'var(--warning-light)' : 'var(--blue-light)',
                  color: p.status === '計画中' ? '#92400E' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {p.phase}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {p.label}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: p.status === '未接続' ? 'var(--text-muted)' : p.status === '計画中' ? '#92400E' : 'var(--blue)',
                }}
              >
                {p.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── API連携ポイント（開発者向け） ── */}
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
                borderBottom: i < apiIntegrationPoints.length - 1 ? '1px solid #334155' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#93C5FD' }}>
                  {point.feature}
                </div>
                <span
                  style={{
                    background: '#334155',
                    color: '#94A3B8',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  Phase {point.phase}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#94A3B8',
                  fontFamily: 'monospace',
                  marginBottom: 2,
                }}
              >
                {point.endpoint}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {point.provider} — {point.note}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* バージョン */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--text-muted)',
          padding: '6px 0 4px',
          lineHeight: 1.7,
        }}
      >
        AI社長室 v0.3.5 Phase 3.5 — {selectedCompany?.name}
        <br />
        フロントエンドMVP（仮データのみ · 外部書き込みなし）
      </div>
    </div>
  )
}

function StatusBadge({
  icon,
  label,
  label2,
  active,
  inactive,
}: {
  icon: string
  label: string
  label2?: string
  active?: boolean
  inactive?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: inactive ? 'rgba(255,255,255,0.06)' : 'rgba(16,185,129,0.25)',
        borderRadius: 8,
        padding: '7px 10px',
        fontSize: 12,
        fontWeight: 700,
        color: inactive ? 'rgba(255,255,255,0.5)' : '#fff',
      }}
    >
      <span>{icon}</span>
      <span>{label2 ?? label}</span>
      {active && !inactive && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#10B981',
            display: 'inline-block',
          }}
        />
      )}
    </div>
  )
}
