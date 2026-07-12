// AI社長室トップ（LCC MVP 仕様の7領域を1画面に集約）
// 既存の Provider / AI Engine / 実データローダーを流用。画面は増やさず Home に埋め込む。
// - 実データ対応（接続時=実データ / 未接続・未設定・失敗=デモ）
// - ローディング / データなし / 取得失敗 を明示（画面は真っ白にしない）
// - 読み取り専用・外部書き込みなし・日本語UI・スマホ対応

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
import type { UnifiedProjectProfit } from '../core/providers/providerTypes'

type SourceState = DataSource | 'loading'

interface Props {
  onNavigate: (screen: Screen) => void
}

// ── 日付ユーティリティ（Asia/Tokyo 前提の端末ローカル）──
function startOfToday(): number {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0).getTime()
}
function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  const s = startOfToday()
  return t >= s && t < s + 86400000
}
function parseDeadline(deadline: string | null): number | null {
  if (!deadline) return null
  if (deadline.includes('今日') || deadline.includes('本日')) return startOfToday()
  const t = new Date(deadline).getTime()
  return Number.isNaN(t) ? null : t
}
function overdueDays(deadline: string | null): number | null {
  const t = parseDeadline(deadline)
  if (t === null) return null
  const diff = startOfToday() - t
  if (diff <= 0) return null
  return Math.floor(diff / 86400000)
}

// ── データソースのバッジ表示 ──
function sourceBadge(state: SourceState): { text: string; color: string; bg: string } {
  switch (state) {
    case 'loading': return { text: '取得中…', color: '#475569', bg: '#F1F5F9' }
    case 'api':
    case 'cache': return { text: '実データ', color: '#065F46', bg: '#D1FAE5' }
    case 'unconfigured': return { text: '未設定', color: '#92400E', bg: '#FEF3C7' }
    case 'error': return { text: '取得失敗', color: '#991B1B', bg: '#FEE2E2' }
    default: return { text: 'デモ', color: '#1D4ED8', bg: '#DBEAFE' }
  }
}

export default function PresidentBrief({ onNavigate }: Props) {
  const dataRef = useRef<OrchestratorInput>(getDemoInput())
  const [result, setResult] = useState<OrchestratorResult>(() => assembleOrchestratorResult(dataRef.current))
  const [status, setStatus] = useState<{ inbox: SourceState; schedule: SourceState; business: SourceState }>({
    inbox: 'loading', schedule: 'loading', business: 'loading',
  })
  const [projects, setProjects] = useState<{ items: UnifiedProjectProfit[]; source: SourceState }>({
    items: [], source: 'loading',
  })
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date())
  const loadedRef = useRef(false)

  function recompute() {
    try {
      setResult(assembleOrchestratorResult(dataRef.current))
      setUpdatedAt(new Date())
    } catch (e) {
      console.error('[PresidentBrief] recompute failed', e)
    }
  }

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    loadInboxItems()
      .then((r) => { dataRef.current = { ...dataRef.current, inbox: r.items }; setStatus((s) => ({ ...s, inbox: r.source })); recompute() })
      .catch(() => setStatus((s) => ({ ...s, inbox: 'error' })))
    loadScheduleItems()
      .then((r) => { dataRef.current = { ...dataRef.current, schedule: r.items }; setStatus((s) => ({ ...s, schedule: r.source })); recompute() })
      .catch(() => setStatus((s) => ({ ...s, schedule: 'error' })))
    loadMetricItems()
      .then((r) => { dataRef.current = { ...dataRef.current, metrics: r.items }; setStatus((s) => ({ ...s, business: r.source })); recompute() })
      .catch(() => setStatus((s) => ({ ...s, business: 'error' })))

    // 進行中プロジェクト（案件別粗利シート由来。実源未設定ならデモ）
    sheetsClient.fetchDataset()
      .then((r) => setProjects({ items: r.dataset.projectProfits ?? [], source: r.source }))
      .catch(() => setProjects({ items: [], source: 'error' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 7領域の算出 ──
  const todaySchedule = useMemo(
    () => dataRef.current.schedule.filter((e) => isToday(e.startAt)),
    [result],
  )
  const actionMail = useMemo(
    () => dataRef.current.inbox
      .filter((i) => i.source === 'gmail' && (i.priority === 'A' || i.priority === 'B') && (!i.isRead || i.replyDraftAvailable))
      .slice(0, 6),
    [result],
  )
  const approvalQueue = result.approvalQueue
  const overdue = useMemo(
    () => dataRef.current.inbox
      .map((i) => ({ item: i, days: overdueDays(i.deadline) }))
      .filter((x): x is { item: typeof x.item; days: number } => x.days !== null)
      .sort((a, b) => b.days - a.days)
      .slice(0, 6),
    [result],
  )
  const aiPriorities = result.todayPlan.decisions.slice(0, 3)

  const dateLabel = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const timeLabel = updatedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ marginBottom: 16 }}>
      {/* ヘッダー: 日付・最終更新・データ状態 */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f2647 0%, #1B3D6F 100%)',
          borderRadius: 16, padding: '14px 16px', marginBottom: 12, color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>🏛 AI社長室</span>
          <span style={{ fontSize: 11, opacity: 0.75 }}>更新 {timeLabel}</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{dateLabel}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {[
            { k: '予定', s: status.schedule },
            { k: 'メール', s: status.inbox },
            { k: '数字', s: status.business },
            { k: '案件', s: projects.source },
            { k: '通知', s: 'mock' as SourceState },
          ].map((x) => {
            const b = sourceBadge(x.s)
            return (
              <span key={x.k} style={{ fontSize: 10, fontWeight: 700, color: b.color, background: b.bg, borderRadius: 999, padding: '2px 8px' }}>
                {x.k}={b.text}
              </span>
            )
          })}
        </div>
      </div>

      {/* 1. 今日の予定 */}
      <Section title="📅 今日の予定" source={status.schedule} count={todaySchedule.length}>
        {status.schedule === 'loading' && todaySchedule.length === 0 ? <Loading /> :
          todaySchedule.length === 0 ? <Empty text="本日の予定はありません" /> :
            todaySchedule.map((e) => (
              <Row key={e.id}
                left={e.startAt ? new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '終日'}
                title={e.title}
                sub={[e.location, e.priority === 'A' ? '重要' : ''].filter(Boolean).join(' · ')}
              />
            ))}
      </Section>

      {/* 2. 要対応メール */}
      <Section title="✉️ 要対応メール" source={status.inbox} count={actionMail.length}>
        {status.inbox === 'loading' && actionMail.length === 0 ? <Loading /> :
          actionMail.length === 0 ? <Empty text="要対応メールはありません" /> :
            actionMail.map((m) => (
              <Row key={m.id} left={m.priority} leftColor={m.priority === 'A' ? '#EF4444' : '#F59E0B'}
                title={m.subject || '（件名なし）'} sub={`${m.fromName}${m.deadline ? ` · 期限:${m.deadline}` : ''}`} />
            ))}
      </Section>

      {/* 3. 社長確認待ち */}
      <Section title="✅ 社長確認待ち" source="mock" count={approvalQueue.length} hideSource>
        {approvalQueue.length === 0 ? <Empty text="確認待ちはありません" /> :
          approvalQueue.map((a) => (
            <Row key={a.id} left="要承認" leftColor="#B45309"
              title={a.title} sub={`${a.targetName} · ${a.actionType}`} />
          ))}
        <Note text="⚠️ 承認・送信・保存は行いません（表示のみ）" />
      </Section>

      {/* 4. 期限超過タスク */}
      <Section title="⏰ 期限超過" source={status.inbox} count={overdue.length}>
        {status.inbox === 'loading' && overdue.length === 0 ? <Loading /> :
          overdue.length === 0 ? <Empty text="期限超過はありません" /> :
            overdue.map(({ item, days }) => (
              <Row key={item.id} left={`${days}日超過`} leftColor="#DC2626"
                title={item.subject || '（件名なし）'} sub={`${item.fromName} · 期限:${item.deadline}`} />
            ))}
      </Section>

      {/* 5. 進行中プロジェクト */}
      <Section title="📁 進行中プロジェクト" source={projects.source} count={projects.items.length}>
        {projects.source === 'loading' ? <Loading /> :
          projects.items.length === 0 ? <Empty text="進行中プロジェクトはありません" /> :
            projects.items.slice(0, 6).map((p, i) => (
              <Row key={p.id ?? i} left={`${p.grossProfitRate}%`}
                leftColor={p.alert || p.grossProfitRate < 10 ? '#DC2626' : '#059669'}
                title={p.projectName} sub={p.alert ? '要注意' : '進行中'} />
            ))}
        {projects.source === 'unconfigured' && <Note text="※ 案件台帳（Sheets）のID未設定のためデモ表示です" />}
      </Section>

      {/* 6. AIによる今日の優先順位 */}
      <Section title="🤖 AIの今日の優先順位" source="mock" count={aiPriorities.length} hideSource>
        {aiPriorities.length === 0 ? <Empty text="優先事項はありません" /> :
          aiPriorities.map((d) => (
            <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{d.rank}. {d.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>理由：{d.reason}</div>
              <div style={{ fontSize: 11, color: '#1D4ED8', marginTop: 2 }}>→ {d.suggestedAction}（{d.timeEstimate}）</div>
            </div>
          ))}
      </Section>

      {/* 7. 相談・指示チャット導線 */}
      <button
        onClick={() => onNavigate('chat')}
        style={{
          width: '100%', background: '#1B3D6F', color: '#fff', border: 'none', borderRadius: 12,
          padding: '13px', fontSize: 14, fontWeight: 800, marginTop: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        💬 AIに相談・指示する（チャットを開く）
      </button>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
        読み取り専用 · 外部送信/書き込みなし · 実データは設定後に反映
      </div>
    </div>
  )
}

// ── 小コンポーネント ──
function Section({ title, source, count, hideSource, children }: {
  title: string; source: SourceState; count: number; hideSource?: boolean; children: React.ReactNode
}) {
  const b = sourceBadge(source)
  return (
    <div style={{ background: '#fff', borderRadius: 14, boxShadow: 'var(--shadow)', padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)' }}>{count}件</span>
          {!hideSource && (
            <span style={{ fontSize: 9, fontWeight: 700, color: b.color, background: b.bg, borderRadius: 999, padding: '2px 7px' }}>{b.text}</span>
          )}
        </span>
      </div>
      {children}
    </div>
  )
}

function Row({ left, leftColor, title, sub }: { left: string; leftColor?: string; title: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: leftColor ?? '#475569', background: (leftColor ?? '#475569') + '18', borderRadius: 6, padding: '2px 7px', minWidth: 40, textAlign: 'center' }}>{left}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</span>}
      </span>
    </div>
  )
}

function Loading() {
  return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>取得中…</div>
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>{text}</div>
}
function Note({ text }: { text: string }) {
  return <div style={{ fontSize: 10, color: '#92400E', marginTop: 6 }}>{text}</div>
}
