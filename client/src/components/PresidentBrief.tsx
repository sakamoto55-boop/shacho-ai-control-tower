// AI社長室トップ（LCC MVP 7領域を1画面に集約）
// 既存の Provider / AI Engine / 実データローダーを流用。画面は増やさず Home に埋め込む。
// - 実データ対応（接続時=実データ / 未接続・未設定・失敗=デモ）
// - 各カードに 実データ/デモ/未設定/取得失敗 バッジ・最終取得時刻・再取得ボタン
// - ローディング / データなし / 取得失敗 を明示（画面は真っ白にしない）
// - 読み取り専用・外部書き込みなし・日本語UI・スマホ対応・長い時は折りたたみ

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Screen } from '../types'
import {
  assembleOrchestratorResult,
  getDemoInput,
  loadInboxItems,
  loadScheduleItems,
  loadMetricItems,
  type OrchestratorInput,
  type DataSource,
} from '../core/ai-engine/aiOrchestrator'
import type { OrchestratorResult } from '../core/ai-engine/aiEngineTypes'
import { sheetsClient } from '../services/sheets/sheetsClient'
import { triageActionMail } from '../core/president/mailTriage'
import { computeOverdue } from '../core/president/overdue'
import { isTodayJst, formatJstTime } from '../core/president/dateUtil'
import { projectLedgerClient, type LedgerSource } from '../core/president/projectLedgerClient'

type SourceState = DataSource | 'loading'

interface Props {
  onNavigate: (screen: Screen) => void
}

interface DisplayProject { name: string; sub: string; rate: number | null }

function sourceBadge(state: SourceState | LedgerSource): { text: string; color: string; bg: string } {
  switch (state) {
    case 'loading': return { text: '取得中…', color: '#475569', bg: '#F1F5F9' }
    case 'api':
    case 'cache': return { text: '実データ', color: '#065F46', bg: '#D1FAE5' }
    case 'unconfigured': return { text: '未設定', color: '#92400E', bg: '#FEF3C7' }
    case 'no_auth': return { text: '未接続', color: '#475569', bg: '#F1F5F9' }
    case 'config_error': return { text: '設定エラー', color: '#991B1B', bg: '#FEE2E2' }
    case 'error': return { text: '取得失敗', color: '#991B1B', bg: '#FEE2E2' }
    default: return { text: 'デモ', color: '#1D4ED8', bg: '#DBEAFE' }
  }
}
const isReal = (s: SourceState | LedgerSource) => s === 'api' || s === 'cache'

export default function PresidentBrief({ onNavigate }: Props) {
  const dataRef = useRef<OrchestratorInput>(getDemoInput())
  const [result, setResult] = useState<OrchestratorResult>(() => assembleOrchestratorResult(dataRef.current))
  const [status, setStatus] = useState<{ inbox: SourceState; schedule: SourceState; business: SourceState }>({
    inbox: 'loading', schedule: 'loading', business: 'loading',
  })
  const [lastFetched, setLastFetched] = useState<{ inbox: Date | null; schedule: Date | null; business: Date | null; projects: Date | null }>({
    inbox: null, schedule: null, business: null, projects: null,
  })
  const [projects, setProjects] = useState<{ list: DisplayProject[]; source: SourceState | LedgerSource; error?: string }>({
    list: [], source: 'loading',
  })
  const [collapsed, setCollapsed] = useState(false)
  const [nonce, setNonce] = useState(0)

  function recompute() {
    try {
      setResult(assembleOrchestratorResult(dataRef.current))
      setNonce((n) => n + 1)
    } catch (e) {
      console.error('[PresidentBrief] recompute failed', e)
    }
  }

  function runLoaders() {
    setStatus({ inbox: 'loading', schedule: 'loading', business: 'loading' })
    setProjects((p) => ({ ...p, source: 'loading' }))

    loadInboxItems()
      .then((r) => { dataRef.current = { ...dataRef.current, inbox: r.items }; setStatus((s) => ({ ...s, inbox: r.source })); setLastFetched((f) => ({ ...f, inbox: new Date() })); recompute() })
      .catch(() => setStatus((s) => ({ ...s, inbox: 'error' })))
    loadScheduleItems()
      .then((r) => { dataRef.current = { ...dataRef.current, schedule: r.items }; setStatus((s) => ({ ...s, schedule: r.source })); setLastFetched((f) => ({ ...f, schedule: new Date() })); recompute() })
      .catch(() => setStatus((s) => ({ ...s, schedule: 'error' })))
    loadMetricItems()
      .then((r) => { dataRef.current = { ...dataRef.current, metrics: r.items }; setStatus((s) => ({ ...s, business: r.source })); setLastFetched((f) => ({ ...f, business: new Date() })); recompute() })
      .catch(() => setStatus((s) => ({ ...s, business: 'error' })))

    // 進行中プロジェクト: 案件台帳（設定済み）を優先。未設定/未接続はデモ（案件別粗利）へ。
    projectLedgerClient.fetchProjects()
      .then(async (r) => {
        if (r.source === 'api') {
          setProjects({
            list: r.projects.map((p) => ({
              name: p.projectName,
              sub: [p.assignee, p.status, p.deadline ? `期限:${p.deadline}` : ''].filter(Boolean).join(' · '),
              rate: p.grossProfit ? Number(p.grossProfit.replace(/[¥,%\s]/g, '')) : null,
            })),
            source: 'api',
          })
        } else if (r.source === 'config_error') {
          setProjects({ list: [], source: 'config_error', error: r.error })
        } else {
          // 未設定/未接続 → デモ（案件別粗利シート）
          const demo = await sheetsClient.fetchDataset().catch(() => null)
          const list: DisplayProject[] = (demo?.dataset.projectProfits ?? []).map((p) => ({
            name: p.projectName, sub: p.alert ? '要注意' : '進行中', rate: p.grossProfitRate,
          }))
          setProjects({ list, source: r.source === 'unconfigured' ? 'unconfigured' : 'mock' })
        }
        setLastFetched((f) => ({ ...f, projects: new Date() }))
      })
      .catch(() => setProjects({ list: [], source: 'error' }))
  }

  useEffect(() => {
    runLoaders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 7領域の算出（nonce更新で再計算）──
  const todaySchedule = useMemo(() => dataRef.current.schedule.filter((e) => isTodayJst(e.startAt)), [nonce])
  const actionMail = useMemo(() => triageActionMail(dataRef.current.inbox, 6), [nonce])
  const approvalQueue = result.approvalQueue
  const overdue = useMemo(() => computeOverdue(dataRef.current.inbox, Date.now(), 6), [nonce])
  const aiPriorities = result.todayPlan.decisions.slice(0, 3)

  const dateLabel = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const fmt = (d: Date | null) => (d ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—')

  return (
    <div style={{ marginBottom: 16 }}>
      {/* ヘッダー */}
      <div style={{ background: 'linear-gradient(135deg, #0f2647 0%, #1B3D6F 100%)', borderRadius: 16, padding: '14px 16px', marginBottom: 12, color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>🏛 AI社長室</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={runLoaders} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, minHeight: 32 }}>↻ 再取得</button>
            <button onClick={() => setCollapsed((c) => !c)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, minHeight: 32 }}>{collapsed ? '展開' : 'たたむ'}</button>
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{dateLabel}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {[
            { k: '予定', s: status.schedule, t: lastFetched.schedule },
            { k: 'メール', s: status.inbox, t: lastFetched.inbox },
            { k: '数字', s: status.business, t: lastFetched.business },
            { k: '案件', s: projects.source as SourceState, t: lastFetched.projects },
            { k: '通知', s: 'mock' as SourceState, t: null },
          ].map((x) => {
            const b = sourceBadge(x.s)
            return (
              <span key={x.k} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: b.bg, borderRadius: 999, padding: '2px 8px' }}>
                {x.k}={b.text}{x.t ? ` ${fmt(x.t)}` : ''}
              </span>
            )
          })}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 1. 今日の予定 */}
          <Section title="📅 今日の予定" source={status.schedule} count={todaySchedule.length} last={lastFetched.schedule}>
            {status.schedule === 'loading' && todaySchedule.length === 0 ? <Loading /> :
              todaySchedule.length === 0 ? <Empty text="本日の予定はありません" /> :
                todaySchedule.map((e) => (
                  <Row key={e.id} left={formatJstTime(e.startAt)} title={e.title}
                    sub={[e.location, e.priority === 'A' ? '重要' : ''].filter(Boolean).join(' · ')} priorityA={e.priority === 'A'} />
                ))}
          </Section>

          {/* 2. 要対応メール（過去72時間・要返信推定・自動送信は降格）*/}
          <Section title="✉️ 要対応メール" source={status.inbox} count={actionMail.length} last={lastFetched.inbox}>
            {status.inbox === 'loading' && actionMail.length === 0 ? <Loading /> :
              actionMail.length === 0 ? <Empty text="要対応メールはありません" /> :
                actionMail.map((t) => (
                  <Row key={t.item.id}
                    left={t.item.priority} leftColor={t.item.priority === 'A' ? '#EF4444' : t.deprioritized ? '#94A3B8' : '#F59E0B'}
                    title={t.item.subject || '（件名なし）'}
                    sub={`${t.item.fromName}${t.item.deadline ? ` · 期限:${t.item.deadline}` : ''}${t.replyNeeded ? ' · 要返信' : t.deprioritized ? ' · 自動/通知' : ''}`}
                    dim={t.deprioritized} priorityA={t.item.priority === 'A' && !t.deprioritized} />
                ))}
            <Note text="過去72時間 · 自動送信/広告/メルマガ/通知は優先度を下げています · 本文全文は非表示" />
          </Section>

          {/* 3. 社長確認待ち */}
          <Section title="✅ 社長確認待ち" count={approvalQueue.length} hideSource>
            {approvalQueue.length === 0 ? <Empty text="確認待ちはありません" /> :
              approvalQueue.map((a) => (
                <Row key={a.id} left="要承認" leftColor="#B45309" title={a.title} sub={`${a.targetName} · ${a.actionType}`} />
              ))}
            <Note text="⚠️ 承認・送信・保存は行いません（表示のみ）" />
          </Section>

          {/* 4. 期限超過（JST・当日より前・完了除外・超過日数）*/}
          <Section title="⏰ 期限超過" source={status.inbox} count={overdue.length} last={lastFetched.inbox}>
            {status.inbox === 'loading' && overdue.length === 0 ? <Loading /> :
              overdue.length === 0 ? <Empty text="期限超過はありません" /> :
                overdue.map(({ item, days }) => (
                  <Row key={item.id} left={`${days}日超過`} leftColor="#DC2626"
                    title={item.subject || '（件名なし）'} sub={`${item.fromName} · 期限:${item.deadline}`} priorityA />
                ))}
          </Section>

          {/* 5. 進行中プロジェクト（案件台帳）*/}
          <Section title="📁 進行中プロジェクト" source={projects.source as SourceState} count={projects.list.length} last={lastFetched.projects}>
            {projects.source === 'loading' ? <Loading /> :
              projects.source === 'config_error' ? <Note text={`⚠️ 案件台帳の設定エラー：${projects.error ?? '列名を確認してください'}（設定画面で修正）`} /> :
                projects.list.length === 0 ? <Empty text={projects.source === 'unconfigured' ? '案件台帳未設定（設定画面で登録）' : '進行中プロジェクトはありません'} /> :
                  projects.list.slice(0, 6).map((p, i) => (
                    <Row key={i} left={p.rate !== null ? `${p.rate}%` : '—'}
                      leftColor={p.rate !== null && p.rate < 10 ? '#DC2626' : '#059669'} title={p.name} sub={p.sub} />
                  ))}
            {projects.source === 'unconfigured' && <Note text="※ 案件台帳（Sheets）未設定のためデモ表示です。設定画面で登録できます。" />}
            {!isReal(projects.source) && projects.list.length > 0 && projects.source !== 'unconfigured' && <Note text="※ デモ表示（実データは案件台帳設定 + Google接続後）" />}
          </Section>

          {/* 6. AIの今日の優先順位 */}
          <Section title="🤖 AIの今日の優先順位" count={aiPriorities.length} hideSource>
            {aiPriorities.length === 0 ? <Empty text="優先事項はありません" /> :
              aiPriorities.map((d) => (
                <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{d.rank}. {d.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>理由：{d.reason}</div>
                  <div style={{ fontSize: 11, color: '#1D4ED8', marginTop: 2 }}>→ {d.suggestedAction}（{d.timeEstimate}）</div>
                </div>
              ))}
          </Section>
        </>
      )}

      {/* 7. 相談・指示チャット導線 */}
      <button onClick={() => onNavigate('chat')}
        style={{ width: '100%', background: '#1B3D6F', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 800, marginTop: 4, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        💬 AIに相談・指示する（チャットを開く）
      </button>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
        読み取り専用 · 外部送信/書き込みなし · 実データは設定後に反映
      </div>
    </div>
  )
}

// ── 小コンポーネント ──
function Section({ title, source, count, hideSource, last, children }: {
  title: string; source?: SourceState; count: number; hideSource?: boolean; last?: Date | null; children: React.ReactNode
}) {
  const b = source ? sourceBadge(source) : null
  return (
    <div style={{ background: '#fff', borderRadius: 14, boxShadow: 'var(--shadow)', padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)' }}>{count}件</span>
          {!hideSource && b && (
            <span style={{ fontSize: 9, fontWeight: 700, color: b.color, background: b.bg, borderRadius: 999, padding: '2px 7px' }}>{b.text}</span>
          )}
        </span>
      </div>
      {children}
      {last && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>最終取得 {last.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</div>}
    </div>
  )
}

function Row({ left, leftColor, title, sub, dim, priorityA }: { left: string; leftColor?: string; title: string; sub?: string; dim?: boolean; priorityA?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)', opacity: dim ? 0.6 : 1 }}>
      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: leftColor ?? '#475569', background: (leftColor ?? '#475569') + '18', borderRadius: 6, padding: '3px 7px', minWidth: 44, textAlign: 'center' }}>{left}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: priorityA ? 800 : 700, color: priorityA ? '#B91C1C' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {priorityA ? '🔴 ' : ''}{title}
        </span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
    </div>
  )
}

function Loading() { return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>取得中…</div> }
function Empty({ text }: { text: string }) { return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>{text}</div> }
function Note({ text }: { text: string }) { return <div style={{ fontSize: 10, color: '#92400E', marginTop: 6, lineHeight: 1.5 }}>{text}</div> }
