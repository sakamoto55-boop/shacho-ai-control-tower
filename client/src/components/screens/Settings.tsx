import { useState } from 'react'
import { companies, integrations, apiIntegrationPoints } from '../../data/mockData'
import { getConnectionStatus, fetchInboxMessages } from '../../services/gmail/gmailClient'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { createGmailSummary } from '../../services/gmail/gmailAnalyzer'
import type { GmailFetchRange, GmailDerivedTask } from '../../types'

interface Props {
  company: string
  onCompanyChange: (id: string) => void
  demoMode: boolean
  productionReady: boolean
  onDemoModeChange: (v: boolean) => void
  onProductionReadyChange: (v: boolean) => void
}

const ROLES = ['社長専用', '管理者', '事務', '現場']

const INTEGRATION_PHASES = [
  { phase: 1, label: 'Gmail読み取り', status: '実装済' },
  { phase: 2, label: 'Googleカレンダー読み取り', status: '未接続' },
  { phase: 3, label: 'Google Drive検索', status: '未接続' },
  { phase: 4, label: 'Googleスプレッドシート読み取り', status: '未接続' },
  { phase: 5, label: 'LINE WORKS通知', status: '未接続' },
  { phase: 6, label: 'Gmail下書き作成', status: '計画中' },
  { phase: 7, label: 'Google Drive保存', status: '計画中' },
  { phase: 8, label: '各種書き込み処理', status: '将来' },
]

export default function Settings({
  company,
  onCompanyChange,
  demoMode,
  productionReady,
  onDemoModeChange,
  onProductionReadyChange,
}: Props) {
  const [activeRole, setActiveRole] = useState('社長専用')
  const [showApiPoints, setShowApiPoints] = useState(false)
  const [showPhaseRoadmap, setShowPhaseRoadmap] = useState(false)
  const [gmailRange, setGmailRange] = useState<GmailFetchRange>('24h')
  const [gmailTestResult, setGmailTestResult] = useState<GmailDerivedTask[] | null>(null)
  const [gmailTesting, setGmailTesting] = useState(false)

  const selectedCompany = companies.find((c) => c.id === company)
  const connectionStatus = getConnectionStatus()
  const gmailSummary = createGmailSummary(mockGmailMessages)

  async function handleGmailReadTest() {
    setGmailTesting(true)
    setGmailTestResult(null)
    const results = await fetchInboxMessages(gmailRange)
    setGmailTestResult(results)
    setGmailTesting(false)
  }

  const MODE_ROWS = [
    { label: 'デモモード',     value: demoMode ? 'ON' : 'OFF',  on: demoMode,     toggle: () => onDemoModeChange(!demoMode) },
    { label: '本番準備モード', value: productionReady ? 'ON' : 'OFF', on: productionReady, toggle: () => onProductionReadyChange(!productionReady) },
    { label: '外部接続',       value: '未接続', on: false, toggle: undefined },
    { label: '読み取り専用予定', value: 'ON', on: true, toggle: undefined },
    { label: '書き込み禁止',   value: 'ON', on: true, toggle: undefined },
  ]

  return (
    <div className="screen-content">
      {/* ── 動作モード設定 ── */}
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
        {MODE_ROWS.map((row) => (
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
            {row.toggle ? (
              <button
                onClick={row.toggle}
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: row.on ? '#065F46' : '#991B1B',
                  background: row.on ? '#D1FAE5' : '#FEE2E2',
                  borderRadius: 6,
                  padding: '2px 8px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {row.value}
              </button>
            ) : (
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
            )}
          </div>
        ))}
      </div>

      {/* ── Gmail読み取りテスト（常時表示） ── */}
      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          marginBottom: 14,
          boxShadow: 'var(--shadow)',
          border: '1.5px solid #BFDBFE',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>📧</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>Gmail読み取りテスト</div>
            <div style={{ fontSize: 10, color: '#3B82F6', fontWeight: 600 }}>
              読み取り専用 · 書き込み禁止 · 外部未接続
            </div>
          </div>
          <span style={{ background: '#DBEAFE', color: '#1D4ED8', borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 800 }}>
            デモGmail
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {[
            { label: '接続状態', value: '未接続', alert: true },
            { label: '権限', value: '読み取り専用', alert: false },
            { label: '書き込み', value: '禁止', alert: false },
            { label: 'データ元', value: 'mockGmail', alert: false },
            { label: '最終取得', value: '2026/06/27 08:15（仮）', alert: false },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                background: 'var(--bg)',
                borderRadius: 8,
                padding: '4px 8px',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{row.label}：</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: row.alert ? '#991B1B' : 'var(--text-primary)' }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF', borderRadius: 8, padding: '6px 10px', marginBottom: 10, lineHeight: 1.5 }}>
          取得対象：受信トレイ / 未読 / 重要そうなメール（過去24時間）
          <br />現在の取得件数：{gmailSummary.totalCount}件 / 重要A：{gmailSummary.priorityACount}件 / 返信たたき台：{gmailSummary.replyDraftCount}件
        </div>

        <div style={{ fontSize: 10, color: '#92400E', background: '#FEF9C3', borderRadius: 8, padding: '6px 10px', marginBottom: 12 }}>
          ⚠️ 本番Gmail未接続 · すべてデモデータ · 実際のメールは取得していません
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleGmailReadTest}
            disabled={gmailTesting}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 10,
              background: gmailTesting ? 'var(--border)' : '#1B3D6F',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {gmailTesting ? '取得中...' : '📥 読み取りテスト'}
          </button>
        </div>

        {gmailTestResult && (
          <div style={{ marginTop: 10, background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#065F46', marginBottom: 6 }}>
              ✅ デモGmailから{gmailTestResult.length}件を読み取りました。書き込み処理は行っていません。
            </div>
            {gmailTestResult.slice(0, 3).map((task) => (
              <div
                key={task.id}
                style={{ padding: '5px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <span
                  style={{
                    background: task.priority === 'A' ? '#FEE2E2' : '#FFFBEB',
                    color: task.priority === 'A' ? '#991B1B' : '#92400E',
                    borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800, flexShrink: 0,
                  }}
                >
                  {task.priority}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.subject}
                </span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
              ※ デモデータ · 本番Gmail未接続 · 送信・返信・下書き保存なし
            </div>
          </div>
        )}
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

      {/* ── Gmail連携（本番準備モードON時のみ表示） ── */}
      {productionReady && (
        <div
          style={{
            background: '#fff',
            borderRadius: 'var(--radius)',
            padding: '16px',
            marginBottom: 18,
            boxShadow: 'var(--shadow)',
            border: '1.5px solid #BFDBFE',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>📧</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>Gmail連携</div>
              <div style={{ fontSize: 11, color: '#3B82F6', fontWeight: 600 }}>読み取り専用 · 書き込み禁止</div>
            </div>
          </div>

          {[
            { label: '接続状態', value: '未接続（認証情報未設定）', alert: true },
            { label: '権限', value: connectionStatus.permission, alert: false },
            { label: '書き込み', value: '禁止', alert: false },
            { label: 'スコープ', value: 'gmail.readonly', alert: false },
            { label: '最終取得', value: '未接続のため表示なし', alert: false },
            { label: '取得対象', value: '受信トレイ・未読・重要メール', alert: false },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '7px 0',
                borderBottom: '1px solid var(--border)',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                {row.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: row.alert ? '#991B1B' : 'var(--text-primary)',
                  fontWeight: 700,
                  textAlign: 'right',
                }}
              >
                {row.value}
              </span>
            </div>
          ))}

          {/* 取得期間ボタン */}
          <div style={{ marginTop: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
              取得期間
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['24h', '3d', '7d'] as GmailFetchRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setGmailRange(r)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background: gmailRange === r ? 'var(--navy)' : 'var(--bg)',
                    color: gmailRange === r ? '#fff' : 'var(--text-secondary)',
                    border: gmailRange === r ? 'none' : '1.5px solid var(--border)',
                  }}
                >
                  {r === '24h' ? '過去24時間' : r === '3d' ? '過去3日' : '過去7日'}
                </button>
              ))}
            </div>
          </div>

          {/* 読み取りテストボタン */}
          <button
            onClick={handleGmailReadTest}
            disabled={gmailTesting}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 12,
              background: gmailTesting ? 'var(--border)' : '#1B3D6F',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            {gmailTesting ? '取得中...' : '📥 読み取りテスト（デモデータ）'}
          </button>

          {/* テスト結果 */}
          {gmailTestResult && (
            <div
              style={{
                background: 'var(--bg)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--navy)', marginBottom: 8 }}>
                デモ結果 — {gmailTestResult.length}件取得
              </div>
              {gmailTestResult.map((task) => (
                <div
                  key={task.id}
                  style={{
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      background: task.priority === 'A' ? '#FEE2E2' : '#FFFBEB',
                      color: task.priority === 'A' ? '#991B1B' : '#92400E',
                      borderRadius: 4,
                      padding: '1px 6px',
                      fontSize: 10,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {task.priority}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {task.subject}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
                ※ デモデータです。実接続ではありません。
              </div>
            </div>
          )}
        </div>
      )}

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
                  background:
                    p.status === '実装済' ? '#D1FAE5' :
                    p.status === '未接続' ? 'var(--bg)' :
                    p.status === '計画中' ? 'var(--warning-light)' : 'var(--blue-light)',
                  color:
                    p.status === '実装済' ? '#065F46' :
                    p.status === '計画中' ? '#92400E' : 'var(--text-muted)',
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
                  color:
                    p.status === '実装済' ? '#065F46' :
                    p.status === '未接続' ? 'var(--text-muted)' :
                    p.status === '計画中' ? '#92400E' : 'var(--blue)',
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
        AI社長室 v0.4.1 Phase 4.1 — {selectedCompany?.name}
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
