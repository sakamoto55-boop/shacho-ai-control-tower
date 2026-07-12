import { useState, useEffect } from 'react'
import { companies, integrations, apiIntegrationPoints } from '../../data/mockData'
import { getConnectionStatus, fetchInboxMessages } from '../../services/gmail/gmailClient'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { createGmailSummary } from '../../services/gmail/gmailAnalyzer'
import { googleAuth } from '../../services/google/googleAuth'
import { googleGis } from '../../services/google/googleGis'
import { googleSession } from '../../services/google/googleSession'
import { GOOGLE_SCOPES, getScopeLabel } from '../../services/google/googleScopes'
import { getOAuthPreConnectCheck } from '../../services/google/googleConfig'
import { providerRegistry } from '../../core/providers/providerRegistry'
import { providerHealth } from '../../core/providers/providerHealth'
import { googleToken } from '../../services/google/googleToken'
import {
  loadScheduleItems,
  loadFileItems,
  loadMetricItems,
  type DataSource,
} from '../../core/ai-engine/aiOrchestrator'
import { getOAuthDiagnostics } from '../../services/google/oauthDiagnostics'
import {
  loadLedgerConfig,
  saveLedgerConfig,
  clearLedgerConfig,
  type LedgerConfig,
} from '../../core/president/projectLedger'
import type { GoogleSession } from '../../services/google/googleSession'
import type { GmailFetchRange, GmailDerivedTask } from '../../types'
import type { ProviderDescriptor } from '../../core/providers/providerTypes'

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
  { phase: 2, label: 'Googleカレンダー読み取り', status: '実装済' },
  { phase: 3, label: 'Google Drive検索', status: '実装済' },
  { phase: 4, label: 'Googleスプレッドシート読み取り', status: '実装済' },
  { phase: 5, label: 'LINE WORKS通知', status: '実装済' },
  { phase: 10, label: 'AI Engine統合 · 全Provider横断 · 社長承認フロー', status: '実装済' },
  { phase: 11, label: 'Gmail下書き作成', status: '計画中' },
  { phase: 12, label: 'Google Sheets保存', status: '計画中' },
  { phase: 13, label: '各種書き込み処理', status: '将来' },
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
  const [showAuthLog, setShowAuthLog] = useState(false)
  const [gmailRange, setGmailRange] = useState<GmailFetchRange>('24h')
  const [gmailTestResult, setGmailTestResult] = useState<GmailDerivedTask[] | null>(null)
  const [gmailTesting, setGmailTesting] = useState(false)
  const [gSession, setGSession] = useState<GoogleSession>(googleSession.get())
  const [gConnecting, setGConnecting] = useState(false)
  const [gConnectError, setGConnectError] = useState<string | null>(null)
  const [providerDescriptors, setProviderDescriptors] = useState<ProviderDescriptor[]>([])

  // Mission 1.3: SHOGUN データ接続状態（Calendar/Drive/Sheets を実取得して判定）
  type SourceState = DataSource | 'loading'
  const [shogunSources, setShogunSources] = useState<{ calendar: SourceState; drive: SourceState; sheets: SourceState }>({
    calendar: 'loading', drive: 'loading', sheets: 'loading',
  })

  // OAuth コールバック後や再マウント時に最新セッション状態を反映
  useEffect(() => {
    setGSession(googleSession.get())
    setProviderDescriptors(providerRegistry.getAllDescriptors())

    loadScheduleItems().then((r) => setShogunSources((s) => ({ ...s, calendar: r.source }))).catch(() => setShogunSources((s) => ({ ...s, calendar: 'error' })))
    loadFileItems().then((r) => setShogunSources((s) => ({ ...s, drive: r.source }))).catch(() => setShogunSources((s) => ({ ...s, drive: 'error' })))
    loadMetricItems().then((r) => setShogunSources((s) => ({ ...s, sheets: r.source }))).catch(() => setShogunSources((s) => ({ ...s, sheets: 'error' })))
  }, [])

  // データソース → 表示ラベル＋色
  function connStateLabel(source: SourceState, hasToken: boolean): { text: string; color: string; bg: string } {
    if (source === 'loading') return { text: '確認中…', color: '#475569', bg: '#F1F5F9' }
    if (source === 'api' || source === 'cache') return { text: '実データ接続済み', color: '#065F46', bg: '#D1FAE5' }
    if (source === 'unconfigured') return { text: '設定不足', color: '#92400E', bg: '#FEF3C7' }
    if (source === 'error') return { text: '取得失敗', color: '#991B1B', bg: '#FEE2E2' }
    // mock
    return hasToken
      ? { text: '取得失敗（要再接続）', color: '#991B1B', bg: '#FEE2E2' }
      : { text: '未接続（デモ）', color: '#475569', bg: '#F1F5F9' }
  }

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

  // GIS トークンモデルで接続（Client Secret不要・バックエンド不要・リダイレクトなし）
  async function handleGoogleConnect() {
    setGConnectError(null)
    setGConnecting(true)
    try {
      await googleGis.connect()
      googleSession.setConnected()
      setGSession(googleSession.get())
      // 実データで全Provider/画面を再初期化するためリロード
      window.location.reload()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Google接続に失敗しました'
      googleSession.setError(msg)
      setGConnectError(msg) // 失敗時はデモへ黙って戻さず、原因を画面表示
      setGConnecting(false)
    }
  }

  function handleGoogleDisconnect() {
    googleAuth.disconnect()
    googleSession.clear()
    setGSession(googleSession.get())
    setGConnectError(null)
  }

  // Mission: OAuth診断 / 案件台帳設定
  const diag = getOAuthDiagnostics()
  const emptyLedger: LedgerConfig = {
    spreadsheetId: '', sheetName: '',
    columns: { projectName: '案件名', assignee: '担当者', status: 'ステータス', revenue: '売上', cost: '原価', grossProfit: '粗利', deadline: '期限', updatedAt: '最終更新' },
  }
  const [ledger, setLedger] = useState<LedgerConfig>(() => loadLedgerConfig() ?? emptyLedger)
  const [ledgerSaved, setLedgerSaved] = useState(false)
  const ledgerConfigured = !!loadLedgerConfig()

  async function handleReconnect() {
    setGConnectError(null)
    googleAuth.disconnect()
    googleSession.clear()
    setGSession(googleSession.get())
    try {
      await googleGis.connect()
      googleSession.setConnected()
      window.location.reload()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '再接続に失敗しました'
      googleSession.setError(msg)
      setGConnectError(msg)
    }
  }

  function handleLedgerSave() {
    saveLedgerConfig(ledger)
    setLedgerSaved(true)
    setTimeout(() => setLedgerSaved(false), 2000)
  }
  function handleLedgerClear() {
    clearLedgerConfig()
    setLedger(emptyLedger)
  }

  const MODE_ROWS = [
    { label: 'デモモード',     value: demoMode ? 'ON' : 'OFF',  on: demoMode,     toggle: () => onDemoModeChange(!demoMode) },
    { label: '本番準備モード', value: productionReady ? 'ON' : 'OFF', on: productionReady, toggle: () => onProductionReadyChange(!productionReady) },
    { label: 'Google接続',    value: gSession.status === 'connected' ? '接続済' : '未接続', on: gSession.status === 'connected', toggle: undefined },
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

      {/* ── Google アカウント接続 ── */}
      <div className="section-label">Google アカウント連携（Phase 5）</div>
      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius)',
          padding: '16px',
          marginBottom: 14,
          boxShadow: 'var(--shadow)',
          border: gSession.status === 'connected'
            ? '1.5px solid #86EFAC'
            : gSession.status === 'error'
              ? '1.5px solid #FCA5A5'
              : '1.5px solid #BFDBFE',
        }}
      >
        {/* ヘッダー */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔐</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>
                Google 接続
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {gSession.connectedEmail ?? 'Gmail / Calendar / Drive / Sheets 読み取り専用（4スコープ）'}
              </div>
            </div>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '3px 10px',
              borderRadius: 999,
              background:
                gSession.status === 'connected' ? '#D1FAE5' :
                gSession.status === 'connecting' ? '#DBEAFE' :
                gSession.status === 'error' ? '#FEE2E2' : '#F1F5F9',
              color:
                gSession.status === 'connected' ? '#065F46' :
                gSession.status === 'connecting' ? '#1D4ED8' :
                gSession.status === 'error' ? '#991B1B' : '#64748B',
            }}
          >
            {gSession.status === 'connected' ? '✓ 接続済み' :
             gSession.status === 'connecting' ? '⏳ 接続中...' :
             gSession.status === 'error' ? '✗ エラー' : '□ 未接続'}
          </span>
        </div>

        {/* 取得権限 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
            現在取得している権限
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: gSession.grantedScopes.includes(GOOGLE_SCOPES.GMAIL_READONLY)
                  ? '#D1FAE5' : '#F1F5F9',
                color: gSession.grantedScopes.includes(GOOGLE_SCOPES.GMAIL_READONLY)
                  ? '#065F46' : '#94A3B8',
                borderRadius: 8,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {gSession.grantedScopes.includes(GOOGLE_SCOPES.GMAIL_READONLY) ? '✓' : '○'}
              {' '}{getScopeLabel(GOOGLE_SCOPES.GMAIL_READONLY)}
            </span>
            {([GOOGLE_SCOPES.CALENDAR_READONLY, GOOGLE_SCOPES.DRIVE_READONLY, GOOGLE_SCOPES.SHEETS_READONLY] as const).map((scope) => (
              <span
                key={scope}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: gSession.grantedScopes.includes(scope)
                    ? '#D1FAE5' : '#F1F5F9',
                  color: gSession.grantedScopes.includes(scope)
                    ? '#065F46' : '#94A3B8',
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {gSession.grantedScopes.includes(scope) ? '✓' : '○'}
                {' '}{getScopeLabel(scope)}
              </span>
            ))}

          </div>
        </div>

        {/* 書き込み禁止表示 */}
        <div
          style={{
            background: '#FEF9C3',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            color: '#92400E',
            fontWeight: 600,
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          ⚠️ 書き込み禁止 — 送信・返信・下書き・削除・ラベル変更・既読化は実装していません
        </div>

        {/* エラー表示 */}
        {(gSession.status === 'error' || gConnectError) && (
          <div
            style={{
              background: '#FEE2E2',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              color: '#991B1B',
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            {gConnectError ?? gSession.lastError}
          </div>
        )}

        {/* 接続前チェック（未接続時のみ表示） */}
        {gSession.status !== 'connected' && (() => {
          const check = getOAuthPreConnectCheck()
          const rows = [
            { label: 'Client ID設定', ok: check.hasClientId, value: check.hasClientId ? (check.clientIdMasked ?? '設定済み') : '未設定' },
            { label: 'Redirect URI設定', ok: check.hasRedirectUri, value: check.hasRedirectUri ? check.redirectUri : '未設定' },
            { label: 'スコープ', ok: true, value: 'readonly 4スコープ（gmail/calendar/drive/sheets）' },
            { label: '書き込みAPI', ok: true, value: '未実装' },
            { label: '本番接続準備', ok: check.isReadyToConnect, value: check.isReadyToConnect ? '完了' : '未完了' },
          ]
          return (
            <div
              style={{
                background: 'var(--bg)',
                borderRadius: 10,
                padding: '10px 12px',
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                🔍 接続前チェック
              </div>
              {rows.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '5px 0',
                    borderBottom: '1px solid var(--border)',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0 }}>
                    {row.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: row.ok ? '#065F46' : '#991B1B',
                      background: row.ok ? '#D1FAE5' : '#FEE2E2',
                      borderRadius: 6,
                      padding: '2px 7px',
                      maxWidth: '55%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.ok ? '✅ ' : '❌ '}{row.value}
                  </span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* 接続・切断ボタン */}
        {gSession.status === 'connected' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setGSession(googleSession.get())}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: 10,
                background: 'var(--bg)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: 700,
                border: '1.5px solid var(--border)',
              }}
            >
              🔄 状態を更新
            </button>
            <button
              onClick={handleGoogleDisconnect}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: 10,
                background: '#FEE2E2',
                color: '#991B1B',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              🔌 切断する
            </button>
          </div>
        ) : (
          <button
            onClick={handleGoogleConnect}
            disabled={gConnecting}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 12,
              background: gConnecting ? 'var(--border)' : '#1B3D6F',
              color: '#fff',
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            {gConnecting ? '⏳ Googleへ接続中...' : '🔐 Googleアカウントで接続（読み取り専用4スコープ）'}
          </button>
        )}

        {/* 認証ログ（折りたたみ） */}
        {gSession.recentLogs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => setShowAuthLog(!showAuthLog)}
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                fontWeight: 600,
                textDecoration: 'underline',
              }}
            >
              {showAuthLog ? '▲ ログを閉じる' : '▼ 認証ログを見る'}
            </button>
            {showAuthLog && (
              <div
                style={{
                  marginTop: 8,
                  background: '#0F172A',
                  borderRadius: 8,
                  padding: '10px 12px',
                  maxHeight: 160,
                  overflow: 'auto',
                }}
              >
                {gSession.recentLogs.map((log, i) => (
                  <div key={i} style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.6, fontFamily: 'monospace' }}>
                    <span style={{ color: '#64748B' }}>
                      {new Date(log.timestamp).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    {' '}
                    <span style={{ color: log.event.includes('error') ? '#F87171' : log.event.includes('success') ? '#4ADE80' : '#60A5FA' }}>
                      [{log.event}]
                    </span>
                    {' '}{log.detail}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI社長室データ基盤 ── */}
      {providerDescriptors.length > 0 && (() => {
        const summary = providerHealth.getSummary()
        const healthColor =
          summary.overallHealth === 'healthy' ? '#065F46' :
          summary.overallHealth === 'degraded' ? '#92400E' : '#64748B'
        const healthBg =
          summary.overallHealth === 'healthy' ? '#D1FAE5' :
          summary.overallHealth === 'degraded' ? '#FEF3C7' : '#F1F5F9'

        return (
          <div
            style={{
              background: '#fff',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              marginBottom: 14,
              boxShadow: 'var(--shadow)',
              border: '1.5px solid #E0E7FF',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>🏗️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>AI社長室データ基盤</div>
                <div style={{ fontSize: 10, color: '#6366F1', fontWeight: 600 }}>
                  Phase 10 — AI Engine統合 · 全Provider横断 · 社長承認フロー · 書き込みなし
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: healthBg,
                  color: healthColor,
                }}
              >
                {summary.overallHealth === 'healthy' ? '✓ 健全' :
                 summary.overallHealth === 'degraded' ? '△ 一部未接続' : '○ 不明'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {[
                { label: '接続済み', value: `${summary.connected}件`, color: '#065F46', bg: '#D1FAE5' },
                { label: '計画中', value: `${summary.planned}件`, color: '#1D4ED8', bg: '#DBEAFE' },
                { label: '合計', value: `${summary.total}件`, color: '#64748B', bg: '#F1F5F9' },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    display: 'flex', gap: 4, alignItems: 'center',
                    background: s.bg, borderRadius: 8, padding: '4px 8px',
                  }}
                >
                  <span style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}：</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {providerDescriptors.map((desc) => {
                const statusColor =
                  desc.connectionStatus === 'connected' ? '#065F46' :
                  desc.connectionStatus === 'demo' ? '#0F766E' :
                  desc.connectionStatus === 'planned' ? '#1D4ED8' : '#64748B'
                const statusBg =
                  desc.connectionStatus === 'connected' ? '#D1FAE5' :
                  desc.connectionStatus === 'demo' ? '#CCFBF1' :
                  desc.connectionStatus === 'planned' ? '#DBEAFE' : '#F1F5F9'
                const statusLabel =
                  desc.connectionStatus === 'connected' ? '接続済み' :
                  desc.connectionStatus === 'demo' ? 'デモ接続' :
                  desc.connectionStatus === 'planned' ? '計画中' :
                  desc.connectionStatus === 'disconnected' ? '未接続' :
                  desc.connectionStatus === 'connecting' ? '接続中' : 'エラー'

                return (
                  <div
                    key={desc.providerId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 10px',
                      background: 'var(--bg)',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
                      {desc.providerName}
                    </span>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 7px',
                        borderRadius: 999, background: statusBg, color: statusColor,
                        flexShrink: 0,
                      }}
                    >
                      {statusLabel}
                    </span>
                    {desc.readOnly && (
                      <span
                        style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px',
                          borderRadius: 6, background: '#F0FDF4', color: '#166534',
                          flexShrink: 0,
                        }}
                      >
                        読取専用
                      </span>
                    )}
                    {desc.nextPhase && (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, maxWidth: 90, textAlign: 'right' }}>
                        {desc.nextPhase}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Google OAuth 接続診断 ── */}
      <div style={{ background: '#fff', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 14, boxShadow: 'var(--shadow)', border: `1.5px solid ${diag.needsReconnect ? '#FCA5A5' : '#BBF7D0'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 20 }}>🔐</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)' }}>Google 接続診断</div>
            <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600 }}>アクセストークンは表示しません</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '3px 9px', color: diag.connected ? '#065F46' : '#991B1B', background: diag.connected ? '#D1FAE5' : '#FEE2E2' }}>
            {diag.connected ? '接続済み' : '未接続'}
          </span>
        </div>

        {diag.connected && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            アカウント：{diag.email ?? '（不明）'}<br />
            有効期限：{diag.expired ? '⚠️ 期限切れ' : diag.expiresInMinutes !== null ? `あと約${diag.expiresInMinutes}分` : '不明'}
          </div>
        )}

        {/* サービス別 取得可否 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {([['Gmail', diag.services.gmail], ['Calendar', diag.services.calendar], ['Drive', diag.services.drive], ['Sheets', diag.services.sheets]] as const).map(([name, ok]) => (
            <span key={name} style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '4px 9px', color: ok ? '#065F46' : '#92400E', background: ok ? '#D1FAE5' : '#FEF3C7' }}>
              {name}：{ok ? '取得可' : 'スコープ無'}
            </span>
          ))}
        </div>

        {diag.needsReconnect && diag.reconnectReason && (
          <div style={{ fontSize: 11, color: '#991B1B', background: '#FEE2E2', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }}>
            ⚠️ {diag.reconnectReason}
          </div>
        )}

        <button onClick={handleReconnect} style={{ width: '100%', padding: '11px', borderRadius: 10, background: '#1B3D6F', color: '#fff', fontSize: 13, fontWeight: 800, minHeight: 44 }}>
          🔄 切断して再接続（gmail/calendar/drive/sheets 読み取り）
        </button>
      </div>

      {/* ── 進行中プロジェクト：案件台帳の設定 ── */}
      <div style={{ background: '#fff', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 14, boxShadow: 'var(--shadow)', border: '1.5px solid #FDE68A' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>📁</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#92400E' }}>案件台帳（進行中プロジェクト）</div>
            <div style={{ fontSize: 10, color: '#B45309', fontWeight: 600 }}>{ledgerConfigured ? '設定済み · 読み取り専用' : '案件台帳未設定'}</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 10, lineHeight: 1.5 }}>
          スプレッドシートIDとシート名、各列の「ヘッダー名」を登録します（列順は自由）。認証情報は保存しません。
        </div>

        {([['spreadsheetID', 'spreadsheetId'], ['シート名', 'sheetName']] as const).map(([label, key]) => (
          <LedgerField key={key} label={label} value={ledger[key]}
            onChange={(v) => setLedger((c) => ({ ...c, [key]: v }))} />
        ))}
        <div style={{ fontSize: 10, fontWeight: 700, color: '#92400E', margin: '8px 0 4px' }}>列のヘッダー名</div>
        {([['案件名(必須)', 'projectName'], ['担当者', 'assignee'], ['ステータス', 'status'], ['売上', 'revenue'], ['原価', 'cost'], ['粗利', 'grossProfit'], ['期限', 'deadline'], ['最終更新', 'updatedAt']] as const).map(([label, key]) => (
          <LedgerField key={key} label={label} value={ledger.columns[key]}
            onChange={(v) => setLedger((c) => ({ ...c, columns: { ...c.columns, [key]: v } }))} />
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={handleLedgerSave} disabled={!ledger.spreadsheetId || !ledger.sheetName} style={{ flex: 1, padding: '10px', borderRadius: 10, background: (!ledger.spreadsheetId || !ledger.sheetName) ? 'var(--border)' : '#B45309', color: '#fff', fontSize: 13, fontWeight: 800, minHeight: 44 }}>
            {ledgerSaved ? '✓ 保存しました' : '保存'}
          </button>
          <button onClick={handleLedgerClear} style={{ padding: '10px 16px', borderRadius: 10, background: '#F1F5F9', color: '#475569', fontSize: 13, fontWeight: 700, minHeight: 44 }}>
            クリア
          </button>
        </div>
      </div>

      {/* ── SHOGUN データ接続状態（Mission 1.3）── */}
      {(() => {
        const hasToken = googleToken.hasToken()
        const gmailState: SourceState = connectionStatus.connected ? 'api' : 'mock'
        const rows: Array<{ name: string; state: SourceState; demoOnly?: boolean }> = [
          { name: 'Gmail', state: gmailState },
          { name: 'Calendar', state: shogunSources.calendar },
          { name: 'Drive', state: shogunSources.drive },
          { name: 'Sheets', state: shogunSources.sheets },
          { name: 'LINE WORKS', state: 'mock', demoOnly: true },
        ]
        return (
          <div
            style={{
              background: '#fff',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              marginBottom: 14,
              boxShadow: 'var(--shadow)',
              border: '1.5px solid #C7D2FE',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>🛰️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#4338CA' }}>SHOGUN データ接続状態</div>
                <div style={{ fontSize: 10, color: '#6366F1', fontWeight: 600 }}>
                  読み取り専用 · 書き込み禁止 · LINE WORKSはデモ
                </div>
              </div>
            </div>
            {rows.map((row) => {
              const label = row.demoOnly
                ? { text: 'デモ（バックエンド必須）', color: '#0F766E', bg: '#CCFBF1' }
                : connStateLabel(row.state, hasToken)
              return (
                <div
                  key={row.name}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{row.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: label.color, background: label.bg, borderRadius: 6, padding: '3px 9px' }}>
                    {label.text}
                  </span>
                </div>
              )
            })}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              ※ Calendar/Drive/Sheets は Google接続（4スコープ）後に実データ化。
              Sheets は .env のシートID設定が必要（未設定は「設定不足」）。
            </div>
          </div>
        )
      })()}

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
              {connectionStatus.connected
                ? '読み取り専用 · 書き込み禁止 · 本番Gmail接続済み'
                : '読み取り専用 · 書き込み禁止 · 外部未接続'}
            </div>
          </div>
          <span style={{
            background: connectionStatus.connected ? '#D1FAE5' : '#DBEAFE',
            color: connectionStatus.connected ? '#065F46' : '#1D4ED8',
            borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 800,
          }}>
            {connectionStatus.connected ? '本番Gmail' : 'デモGmail'}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {[
            { label: '接続状態', value: connectionStatus.connected ? '本番接続済み' : '未接続', alert: !connectionStatus.connected },
            { label: 'モード', value: connectionStatus.mode === 'production' ? '本番Gmail接続' : 'デモモード', alert: false },
            { label: '権限', value: '読み取り専用', alert: false },
            { label: '書き込み', value: '禁止', alert: false },
            { label: 'データ元', value: connectionStatus.connected ? 'Gmail API' : 'mockGmail', alert: false },
            { label: '取得件数', value: connectionStatus.connected ? `${connectionStatus.itemCount}件` : '— (デモ)', alert: false },
            {
              label: '最終取得',
              value: connectionStatus.lastFetchAt
                ? connectionStatus.lastFetchAt.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : (connectionStatus.connected ? '未取得' : '—（デモ）'),
              alert: false,
            },
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
          <br />デモ集計：{gmailSummary.totalCount}件 / 重要A：{gmailSummary.priorityACount}件 / 返信たたき台：{gmailSummary.replyDraftCount}件
        </div>

        {connectionStatus.connected ? (
          <div style={{ fontSize: 10, color: '#065F46', background: '#D1FAE5', borderRadius: 8, padding: '6px 10px', marginBottom: 12 }}>
            ✅ 本番Gmail接続済み · gmail.readonly · 読み取りテストで実メールを取得します · 送信/返信/削除は不可
          </div>
        ) : (
          <div style={{ fontSize: 10, color: '#92400E', background: '#FEF9C3', borderRadius: 8, padding: '6px 10px', marginBottom: 12 }}>
            ⚠️ 本番Gmail未接続 · すべてデモデータ · 実際のメールは取得していません
          </div>
        )}

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
              ✅ {connectionStatus.connected ? '本番Gmail' : 'デモGmail'}から{gmailTestResult.length}件を読み取りました。書き込み処理は行っていません。
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
              ※ {connectionStatus.connected ? '本番Gmail（gmail.readonly）' : 'デモデータ · 本番Gmail未接続'} · 送信・返信・下書き保存なし
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
        AI社長室 v1.0.0 Phase 10 — {selectedCompany?.name}
        <br />
        Phase 10 — AI Engine統合 · 全Provider横断 · 社長承認フロー（UIと型のみ）
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

// 案件台帳 設定用の入力フィールド
function LedgerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', minWidth: 96, flexShrink: 0 }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)' }}
      />
    </div>
  )
}
