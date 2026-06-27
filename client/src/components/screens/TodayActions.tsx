import { useState, useMemo } from 'react'
import type { ActionItem, Priority, GmailDerivedTask } from '../../types'
import { actionItems } from '../../data/mockData'
import { mockGmailMessages } from '../../services/gmail/mockGmail'
import { mapToGmailDerivedTask } from '../../services/gmail/gmailMapper'
import { mockLineWorksNotifications, mockLineWorksInboxMessages } from '../../services/lineworks/mockLineworks'
import { mapLineWorksToUnifiedNotification, mapLineWorksToUnifiedInboxItem } from '../../services/lineworks/lineworksMapper'
import type { UnifiedNotification, UnifiedInboxItem } from '../../core/providers/providerTypes'
import DemoBanner from '../DemoBanner'
import { runOrchestrator } from '../../core/ai-engine/aiOrchestrator'

interface Props {
  demoMode?: boolean
}

const SECTIONS: { priority: Priority; label: string; icon: string; color: string }[] = [
  { priority: 'A', label: '優先度A ― 今日必ず対応', icon: '🔴', color: '#EF4444' },
  { priority: 'B', label: '優先度B ― 今週中に対応', icon: '🟡', color: '#F59E0B' },
  { priority: 'waiting-confirm', label: '確認待ち', icon: '🔵', color: '#3B82F6' },
  { priority: 'waiting-create', label: '作成待ち', icon: '⚪', color: '#64748B' },
]

const TYPE_COLORS: Record<string, string> = {
  'メール': '#3B82F6',
  'LINE WORKS': '#10B981',
  '承認': '#7C3AED',
  '契約': '#DB2777',
  '請求': '#F59E0B',
  '現場': '#D97706',
  '事故': '#EF4444',
  '銀行': '#1B3D6F',
  '福祉': '#DB2777',
}

const STATUS_CONFIG: Record<string, { bg: string; color: string }> = {
  '未対応': { bg: '#FEF2F2', color: '#991B1B' },
  '対応中': { bg: '#FFF7ED', color: '#C2410C' },
  '確認中': { bg: '#EFF6FF', color: '#1D4ED8' },
  '完了': { bg: '#ECFDF5', color: '#065F46' },
}

const gmailTasks: GmailDerivedTask[] = mockGmailMessages.map(mapToGmailDerivedTask)
const lwNotifications: UnifiedNotification[] = mockLineWorksNotifications.map(mapLineWorksToUnifiedNotification)
const lwInboxItems: UnifiedInboxItem[] = mockLineWorksInboxMessages.map(mapLineWorksToUnifiedInboxItem)

type ActiveTab = 'ai' | 'mail' | 'schedule' | 'file' | 'metric' | 'notification'

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'ai', label: 'AI優先順' },
  { id: 'mail', label: 'メール' },
  { id: 'schedule', label: '予定' },
  { id: 'file', label: '資料' },
  { id: 'metric', label: '数字' },
  { id: 'notification', label: '社内通知' },
]

export default function TodayActions({ demoMode }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('ai')
  const [expanded, setExpanded] = useState<Priority>('A')
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [selectedItem, setSelectedItem] = useState<ActionItem | null>(null)
  const [selectedGmailTask, setSelectedGmailTask] = useState<GmailDerivedTask | null>(null)
  const [gmailExpanded, setGmailExpanded] = useState(true)
  const [lwExpanded, setLwExpanded] = useState(true)
  const [selectedLwNotif, setSelectedLwNotif] = useState<UnifiedNotification | null>(null)
  const [selectedLwInbox, setSelectedLwInbox] = useState<UnifiedInboxItem | null>(null)
  const orchestratorResult = useMemo(() => runOrchestrator(), [])

  function toggleDone(id: string) {
    setDoneIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const priorityABTasks = gmailTasks.filter((t) => t.priority === 'A' || t.priority === 'B')

  return (
    <>
      <div className="screen-content">
        <DemoBanner />

        {/* ── タブバー（Phase 10）── */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            marginBottom: 14,
            background: '#F1F5F9',
            borderRadius: 12,
            padding: 3,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flexShrink: 0,
                padding: '7px 12px',
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 700,
                background: activeTab === tab.id ? '#fff' : 'transparent',
                color: activeTab === tab.id ? 'var(--navy)' : 'var(--text-muted)',
                boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {tab.id === 'ai' && activeTab !== 'ai' && orchestratorResult.todayPlan.decisions.length > 0
                ? `AI優先順 (${orchestratorResult.todayPlan.decisions.length})`
                : tab.label}
            </button>
          ))}
        </div>

        {/* ── AI優先順タブ ── */}
        {activeTab === 'ai' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, padding: '0 2px' }}>
              🤖 全Provider横断 AI判断 · 読み取り専用 · 外部実行なし
            </div>
            {orchestratorResult.todayPlan.decisions.map((decision, i) => {
              const urgencyColor = decision.urgency === 'critical' ? '#EF4444' : decision.urgency === 'high' ? '#F59E0B' : '#3B82F6'
              const urgencyBg = decision.urgency === 'critical' ? '#FEE2E2' : decision.urgency === 'high' ? '#FEF3C7' : '#EFF6FF'
              return (
                <div
                  key={decision.id}
                  style={{
                    background: '#fff',
                    borderRadius: 14,
                    padding: '14px',
                    marginBottom: 10,
                    boxShadow: 'var(--shadow)',
                    border: decision.urgency === 'critical' ? '1.5px solid #FCA5A5' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: i === 0 ? '#EF4444' : i === 1 ? '#F59E0B' : 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>
                      {decision.rank}
                    </div>
                    <span style={{ background: urgencyBg, color: urgencyColor, borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>
                      {decision.urgency === 'critical' ? '🚨 緊急' : decision.urgency === 'high' ? '⚠️ 重要' : '📋 通常'}
                    </span>
                    <span style={{ background: '#F1F5F9', color: '#475569', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
                      {decision.category}
                    </span>
                    {decision.isImmediate && (
                      <span style={{ background: '#ECFDF5', color: '#065F46', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>⚡ 30分</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: urgencyColor, fontWeight: 700 }}>{decision.timeEstimate}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {decision.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5, marginBottom: 6 }}>
                    📌 {decision.reason}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--navy)', fontWeight: 600, background: 'var(--blue-light)', borderRadius: 8, padding: '6px 10px' }}>
                    ✅ {decision.suggestedAction}
                  </div>
                  {decision.evidenceSources.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {decision.evidenceSources.slice(0, 3).map((src) => (
                        <span key={src.id} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '1px 6px', fontSize: 10, color: '#475569', fontWeight: 600 }}>
                          {src.type}: {src.title.slice(0, 20)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── 既存コンテンツ（メール/予定/資料/数字/社内通知タブ）── */}
        {activeTab !== 'ai' && <>
        {SECTIONS.map((sec) => {
          const items = actionItems.filter((i) => i.priority === sec.priority)
          const isOpen = expanded === sec.priority
          const doneCount = items.filter((i) => doneIds.has(i.id)).length

          return (
            <div key={sec.priority} style={{ marginBottom: 12 }}>
              <button
                onClick={() => setExpanded(isOpen ? ('' as Priority) : sec.priority)}
                style={{
                  width: '100%',
                  background: '#fff',
                  borderRadius: isOpen ? '16px 16px 0 0' : 16,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: 'var(--shadow)',
                  borderBottom: isOpen ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 18 }}>{sec.icon}</span>
                <span
                  style={{
                    flex: 1,
                    fontWeight: 800,
                    fontSize: 14,
                    textAlign: 'left',
                    color: sec.color,
                  }}
                >
                  {sec.label}
                </span>
                <span
                  style={{
                    background: sec.color + '20',
                    color: sec.color,
                    borderRadius: 999,
                    padding: '3px 10px',
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {doneCount}/{items.length}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>

              {isOpen && (
                <div
                  style={{
                    background: '#fff',
                    borderRadius: '0 0 16px 16px',
                    boxShadow: 'var(--shadow)',
                    overflow: 'hidden',
                  }}
                >
                  {items.map((item, idx) => (
                    <ActionCard
                      key={item.id}
                      item={item}
                      accentColor={sec.color}
                      done={doneIds.has(item.id)}
                      onToggleDone={() => toggleDone(item.id)}
                      last={idx === items.length - 1}
                      onDetail={() => setSelectedItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* ── Gmailからの要対応 ── */}
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setGmailExpanded(!gmailExpanded)}
            style={{
              width: '100%',
              background: '#EFF6FF',
              borderRadius: gmailExpanded ? '16px 16px 0 0' : 16,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: 'var(--shadow)',
              borderBottom: gmailExpanded ? '1px solid #BFDBFE' : 'none',
              border: '1.5px solid #BFDBFE',
            }}
          >
            <span style={{ fontSize: 18 }}>📧</span>
            <span
              style={{
                flex: 1,
                fontWeight: 800,
                fontSize: 14,
                textAlign: 'left',
                color: '#1D4ED8',
              }}
            >
              Gmailからの要対応
            </span>
            {demoMode !== false && (
              <span
                style={{
                  background: '#DBEAFE',
                  color: '#1D4ED8',
                  borderRadius: 999,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                デモ
              </span>
            )}
            <span
              style={{
                background: '#BFDBFE',
                color: '#1D4ED8',
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {priorityABTasks.length}件
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {gmailExpanded ? '▲' : '▼'}
            </span>
          </button>

          {gmailExpanded && (
            <div
              style={{
                background: '#fff',
                borderRadius: '0 0 16px 16px',
                boxShadow: 'var(--shadow)',
                overflow: 'hidden',
                border: '1.5px solid #BFDBFE',
                borderTop: 'none',
              }}
            >
              {priorityABTasks.map((task, idx) => (
                <GmailTaskCard
                  key={task.id}
                  task={task}
                  last={idx === priorityABTasks.length - 1}
                  onDetail={() => setSelectedGmailTask(task)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── LINE WORKS からの要対応 ── */}
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setLwExpanded(!lwExpanded)}
            style={{
              width: '100%',
              background: '#F0FDFA',
              borderRadius: lwExpanded ? '16px 16px 0 0' : 16,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: 'var(--shadow)',
              borderBottom: lwExpanded ? '1px solid #CCFBF1' : 'none',
              border: '1.5px solid #CCFBF1',
            }}
          >
            <span style={{ fontSize: 18 }}>💬</span>
            <span style={{ flex: 1, fontWeight: 800, fontSize: 14, textAlign: 'left', color: '#0F766E' }}>
              LINE WORKSからの要対応
            </span>
            {demoMode !== false && (
              <span style={{ background: '#CCFBF1', color: '#0F766E', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                デモ
              </span>
            )}
            <span style={{ background: '#CCFBF1', color: '#0F766E', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 800 }}>
              {lwNotifications.length + lwInboxItems.length}件
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {lwExpanded ? '▲' : '▼'}
            </span>
          </button>

          {lwExpanded && (
            <div
              style={{
                background: '#fff',
                borderRadius: '0 0 16px 16px',
                boxShadow: 'var(--shadow)',
                overflow: 'hidden',
                border: '1.5px solid #CCFBF1',
                borderTop: 'none',
              }}
            >
              {/* 緊急通知 */}
              {lwNotifications.map((notif, idx) => (
                <LineWorksNotifCard
                  key={notif.id}
                  notif={notif}
                  last={idx === lwNotifications.length - 1 && lwInboxItems.length === 0}
                  onDetail={() => setSelectedLwNotif(notif)}
                />
              ))}
              {/* 受信箱 */}
              {lwInboxItems.map((item, idx) => (
                <LineWorksInboxCard
                  key={item.id}
                  item={item}
                  last={idx === lwInboxItems.length - 1}
                  onDetail={() => setSelectedLwInbox(item)}
                />
              ))}
            </div>
          )}
        </div>
        </>}
      </div>

      {/* 既存タスク詳細モーダル */}
      {selectedItem && (
        <TaskDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {/* Gmail詳細モーダル */}
      {selectedGmailTask && (
        <GmailTaskModal task={selectedGmailTask} onClose={() => setSelectedGmailTask(null)} />
      )}

      {/* LINE WORKS 通知詳細モーダル */}
      {selectedLwNotif && (
        <LineWorksNotifModal notif={selectedLwNotif} onClose={() => setSelectedLwNotif(null)} />
      )}

      {/* LINE WORKS 受信箱詳細モーダル */}
      {selectedLwInbox && (
        <LineWorksInboxModal item={selectedLwInbox} onClose={() => setSelectedLwInbox(null)} />
      )}
    </>
  )
}

function GmailTaskCard({
  task,
  last,
  onDetail,
}: {
  task: GmailDerivedTask
  last: boolean
  onDetail: () => void
}) {
  const priorityColor = task.priority === 'A' ? '#EF4444' : '#F59E0B'

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: last ? 'none' : '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ background: '#DBEAFE', color: '#1D4ED8', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
          📧 Gmail
        </span>
        <span style={{ background: '#E0E7FF', color: '#4338CA', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          デモGmail
        </span>
        <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          読み取り専用
        </span>
        <span style={{ background: priorityColor + '20', color: priorityColor, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
          優先度{task.priority}
        </span>
        <span style={{ background: '#FEF2F2', color: '#991B1B', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          返信未送信
        </span>
        <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          社長承認待ち
        </span>
      </div>

      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
          marginBottom: 5,
        }}
      >
        {task.subject}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '3px 12px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}
      >
        <span>👤 {task.from}</span>
        {task.estimatedDeadline && <span>⏰ {task.estimatedDeadline}</span>}
      </div>

      <div
        style={{
          background: '#EFF6FF',
          borderRadius: 8,
          padding: '7px 10px',
          fontSize: 12,
          fontWeight: 600,
          color: '#1D4ED8',
          marginBottom: 8,
        }}
      >
        → {task.recommendedAction}
      </div>

      <button
        onClick={onDetail}
        style={{
          background: 'var(--blue-light)',
          color: 'var(--navy)',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        📋 詳細・返信文たたき台を見る
      </button>
    </div>
  )
}

function GmailTaskModal({
  task,
  onClose,
}: {
  task: GmailDerivedTask
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard?.writeText(task.replyDraft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
          background: '#fff',
          borderRadius: '24px 24px 0 0',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div
            style={{
              width: 40,
              height: 4,
              background: '#E2E8F0',
              borderRadius: 4,
              margin: '0 auto 14px',
            }}
          />

          {/* 送信禁止バナー */}
          <div
            style={{
              background: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              color: '#92400E',
              fontWeight: 700,
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            ⚠️ 送信はPhase後工程 — 社長確認後、手動で送信してください
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: '#DBEAFE',
                    color: '#1D4ED8',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  📧 Gmail
                </span>
                <span
                  style={{
                    background: '#D1FAE5',
                    color: '#065F46',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  読み取り専用
                </span>
                {task.estimatedDeadline && (
                  <span
                    style={{
                      background: '#FEE2E2',
                      color: '#B91C1C',
                      borderRadius: 6,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    ⏰ {task.estimatedDeadline}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: 'var(--text-primary)' }}>
                {task.subject}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                👤 {task.from}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--bg)',
                color: 'var(--text-secondary)',
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)',
            scrollbarWidth: 'none',
          }}
        >
          {/* メタ情報 */}
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
            {[
              { label: '元データ', value: 'デモGmail（本番未接続）' },
              { label: '受信日時', value: task.receivedAt.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
              { label: '推定重要度', value: `優先度${task.priority} · ${task.taskType}` },
              { label: '返信状態', value: task.replyStatus },
              { label: '書き込み', value: '禁止' },
            ].map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{row.label}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{row.value}</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
              📋 メール要約
            </div>
            <div
              style={{
                background: 'var(--bg)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 14,
                lineHeight: 1.7,
                color: 'var(--text-primary)',
              }}
            >
              {task.summary}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
              ✅ 推奨アクション
            </div>
            <div
              style={{
                background: '#EFF6FF',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 14,
                color: '#1D4ED8',
                fontWeight: 600,
              }}
            >
              {task.recommendedAction}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
              ✉️ 返信文たたき台
            </div>
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: '16px',
                fontSize: 14,
                lineHeight: 1.8,
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                marginBottom: 10,
              }}
            >
              {task.replyDraft}
            </div>
            <button
              onClick={handleCopy}
              style={{
                width: '100%',
                minHeight: 44,
                borderRadius: 12,
                background: copied ? '#10B981' : 'var(--navy)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {copied ? '✅ コピーしました' : '📋 返信文をコピー'}
            </button>
            <div
              style={{
                marginTop: 10,
                background: '#FEF9C3',
                border: '1px solid #FDE68A',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 11,
                color: '#92400E',
                fontWeight: 700,
                lineHeight: 1.6,
              }}
            >
              ⚠️ これは下書き案です。Gmailには保存・送信されていません。
              <br />送信・返信は社長が内容を確認後、手動でのみ行えます。
            </div>
          </div>

          {task.relatedKeywords.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>
                🏷️ 関連キーワード
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {task.relatedKeywords.map((kw) => (
                  <span
                    key={kw}
                    style={{
                      background: 'var(--blue-light)',
                      color: 'var(--navy)',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionCard({
  item,
  accentColor,
  done,
  onToggleDone,
  last,
  onDetail,
}: {
  item: ActionItem
  accentColor: string
  done: boolean
  onToggleDone: () => void
  last: boolean
  onDetail: () => void
}) {
  const typeColor = TYPE_COLORS[item.type] ?? '#64748B'
  const statusStyle = STATUS_CONFIG[item.status] ?? STATUS_CONFIG['未対応']

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        opacity: done ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button
          onClick={onToggleDone}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: `2px solid ${done ? accentColor : 'var(--border)'}`,
            background: done ? accentColor : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 2,
            fontSize: 12,
            color: '#fff',
            transition: 'all 0.2s',
          }}
        >
          {done ? '✓' : ''}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              marginBottom: 5,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                background: typeColor + '18',
                color: typeColor,
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {item.type}
            </span>
            <span
              style={{
                background: statusStyle.bg,
                color: statusStyle.color,
                borderRadius: 6,
                padding: '2px 7px',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {item.status}
            </span>
            {item.importance === 'high' && (
              <span
                style={{
                  background: '#FEE2E2',
                  color: '#B91C1C',
                  borderRadius: 6,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                重要
              </span>
            )}
          </div>

          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: done ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: done ? 'line-through' : 'none',
              lineHeight: 1.4,
              marginBottom: 5,
            }}
          >
            {item.subject}
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '3px 12px',
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 8,
            }}
          >
            <span>👤 {item.from}</span>
            <span>⏰ {item.deadline}</span>
          </div>

          <div
            style={{
              background: accentColor + '0d',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 12,
              fontWeight: 600,
              color: accentColor,
              marginBottom: 8,
            }}
          >
            → 推奨: {item.action}
          </div>

          <button
            onClick={onDetail}
            style={{
              background: 'var(--blue-light)',
              color: 'var(--navy)',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            📋 詳細・返信文を見る
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskDetailModal({ item, onClose }: { item: ActionItem; onClose: () => void }) {
  const [tab, setTab] = useState<'overview' | 'reply' | 'next'>('overview')
  const typeColor = TYPE_COLORS[item.type] ?? '#64748B'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
          background: '#fff',
          borderRadius: '24px 24px 0 0',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div
            style={{
              width: 40,
              height: 4,
              background: '#E2E8F0',
              borderRadius: 4,
              margin: '0 auto 14px',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: typeColor + '18',
                    color: typeColor,
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {item.type}
                </span>
                <span
                  style={{
                    background: '#FEE2E2',
                    color: '#B91C1C',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  ⏰ {item.deadline}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: 'var(--text-primary)' }}>
                {item.subject}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                👤 {item.from}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--bg)',
                color: 'var(--text-secondary)',
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {(
              [
                { key: 'overview', label: '概要・背景' },
                { key: 'reply', label: '返信文たたき台' },
                { key: 'next', label: '次のアクション' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: tab === t.key ? 'var(--navy)' : 'var(--text-muted)',
                  borderBottom: tab === t.key ? '2px solid var(--navy)' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)',
            scrollbarWidth: 'none',
          }}
        >
          {tab === 'overview' && (
            <div>
              <Section title="要約" icon="📋">
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>
                  {item.detail.summary}
                </p>
              </Section>
              <Section title="背景・経緯" icon="🕐">
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>
                  {item.detail.background}
                </p>
              </Section>
              <Section title="推奨アクション" icon="✅">
                {item.detail.recommendedActions.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginBottom: 6,
                      fontSize: 14,
                      color: 'var(--text-primary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: 'var(--navy)', fontWeight: 700, flexShrink: 0 }}>
                      {i + 1}.
                    </span>
                    <span>{a}</span>
                  </div>
                ))}
              </Section>
              {item.detail.relatedData.length > 0 && (
                <Section title="関連データ" icon="📊">
                  {item.detail.relatedData.map((d, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'var(--blue-light)',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: 12,
                        color: 'var(--navy)',
                        marginBottom: 5,
                        fontWeight: 600,
                      }}
                    >
                      {d}
                    </div>
                  ))}
                </Section>
              )}
            </div>
          )}

          {tab === 'reply' && (
            <div>
              {item.detail.replyDraft ? (
                <>
                  <div
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid var(--border)',
                      borderRadius: 14,
                      padding: '16px',
                      fontSize: 14,
                      lineHeight: 1.8,
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                      marginBottom: 14,
                    }}
                  >
                    {item.detail.replyDraft}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => navigator.clipboard?.writeText(item.detail.replyDraft)}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 12,
                        background: 'var(--navy)',
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      📋 コピー
                    </button>
                    <button
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 12,
                        background: 'var(--bg)',
                        color: 'var(--text-secondary)',
                        fontSize: 13,
                        fontWeight: 700,
                        border: '1px solid var(--border)',
                      }}
                    >
                      📧 Gmail下書き予定
                    </button>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                    }}
                  >
                    ※ Gmail連携後は自動で下書きに保存できます
                  </div>
                </>
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '32px 16px',
                    color: 'var(--text-muted)',
                    fontSize: 14,
                  }}
                >
                  このタスクには返信文は不要です
                </div>
              )}
            </div>
          )}

          {tab === 'next' && (
            <div>
              <Section title="次にやること" icon="📌">
                {item.detail.nextSteps.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      marginBottom: 10,
                      padding: '10px 12px',
                      background: '#fff',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'var(--blue-light)',
                        color: 'var(--navy)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </div>
                    <span style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      {s}
                    </span>
                  </div>
                ))}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── LINE WORKS 通知カード ────────────────────────────────────

function LineWorksNotifCard({
  notif,
  last,
  onDetail,
}: {
  notif: UnifiedNotification
  last: boolean
  onDetail: () => void
}) {
  const borderColor = notif.urgency === 'critical' ? '#EF4444' : '#F59E0B'

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ background: '#CCFBF1', color: '#0F766E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
          💬 LINE WORKS
        </span>
        <span style={{ background: '#F0FDFA', color: '#0F766E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          デモLINE WORKS
        </span>
        <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          読み取り専用
        </span>
        <span style={{ background: '#FEF2F2', color: '#991B1B', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          返信未送信
        </span>
        <span style={{ background: '#F0FDFA', color: '#0F766E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          既読化なし
        </span>
        {notif.priority === 'A' && (
          <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
            社長確認待ち
          </span>
        )}
        <span style={{ background: borderColor + '20', color: borderColor, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
          {notif.urgency === 'critical' ? '🚨 緊急' : '⚠️ 重要'}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 5 }}>
        {notif.title}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {notif.senderName && <span>👤 {notif.senderName}</span>}
        {notif.senderDepartment && <span>🏢 {notif.senderDepartment}</span>}
        {notif.sentAt && (
          <span>
            🕐 {new Date(notif.sentAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {notif.suggestedAction && (
        <div style={{ background: '#F0FDFA', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#0F766E', marginBottom: 8 }}>
          → {notif.suggestedAction}
        </div>
      )}

      <button
        onClick={onDetail}
        style={{ background: '#F0FDFA', color: '#0F766E', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #CCFBF1' }}
      >
        📋 詳細を見る
      </button>
    </div>
  )
}

function LineWorksInboxCard({
  item,
  last,
  onDetail,
}: {
  item: UnifiedInboxItem
  last: boolean
  onDetail: () => void
}) {
  const priorityColor = item.priority === 'A' ? '#EF4444' : '#F59E0B'

  return (
    <div style={{ padding: '14px 16px', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ background: '#CCFBF1', color: '#0F766E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
          💬 LINE WORKS
        </span>
        <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          読み取り専用
        </span>
        <span style={{ background: priorityColor + '20', color: priorityColor, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>
          優先度{item.priority}
        </span>
        <span style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
          社長承認待ち
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 5 }}>
        {item.subject}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <span>👤 {item.fromName}</span>
        {item.deadline && <span>⏰ {item.deadline}</span>}
      </div>

      <div style={{ background: '#F0FDFA', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#0F766E', marginBottom: 8 }}>
        → {item.bodyPreview.slice(0, 80)}
      </div>

      <button
        onClick={onDetail}
        style={{ background: '#F0FDFA', color: '#0F766E', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #CCFBF1' }}
      >
        📋 詳細を見る
      </button>
    </div>
  )
}

function LineWorksNotifModal({ notif, onClose }: { notif: UnifiedNotification; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-end', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: '#fff', borderRadius: '24px 24px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, background: '#E2E8F0', borderRadius: 4, margin: '0 auto 14px' }} />
          <div style={{ background: '#F0FDFA', border: '1px solid #CCFBF1', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#0F766E', fontWeight: 700, marginBottom: 12 }}>
            ⚠️ 送信・返信・既読化は禁止です — 社長確認後、LINE WORKSで直接対応してください
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ background: '#CCFBF1', color: '#0F766E', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>💬 LINE WORKS</span>
                <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>読み取り専用</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: 'var(--text-primary)' }}>{notif.title}</div>
              {notif.senderName && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>👤 {notif.senderName}（{notif.senderDepartment ?? 'LINE WORKS'}）</div>}
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)', scrollbarWidth: 'none' }}>
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
            {[
              { label: '元データ', value: 'デモLINE WORKS（本番未接続）' },
              { label: 'カテゴリ', value: notif.category ?? '通知' },
              { label: '緊急度', value: notif.urgency ?? '—' },
              { label: '書き込み', value: '禁止（送信・既読化・削除なし）' },
            ].map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{row.label}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{row.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>📋 通知内容</div>
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)' }}>{notif.body}</div>
          </div>
          {notif.suggestedAction && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>✅ 推奨アクション</div>
              <div style={{ background: '#F0FDFA', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0F766E', fontWeight: 600 }}>{notif.suggestedAction}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LineWorksInboxModal({ item, onClose }: { item: UnifiedInboxItem; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-end', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: '#fff', borderRadius: '24px 24px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '12px 18px 0', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, background: '#E2E8F0', borderRadius: 4, margin: '0 auto 14px' }} />
          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#92400E', fontWeight: 700, marginBottom: 12 }}>
            ⚠️ 送信・返信・既読化は禁止です — 社長確認後、LINE WORKSで直接対応してください
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ background: '#CCFBF1', color: '#0F766E', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>💬 LINE WORKS</span>
                <span style={{ background: '#D1FAE5', color: '#065F46', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>読み取り専用</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: 'var(--text-primary)' }}>{item.subject}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>👤 {item.fromName}{item.deadline && ` · ⏰ ${item.deadline}`}</div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px calc(env(safe-area-inset-bottom, 0px) + 24px)', scrollbarWidth: 'none' }}>
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
            {[
              { label: '元データ', value: 'デモLINE WORKS（本番未接続）' },
              { label: '優先度', value: `優先度${item.priority}` },
              { label: '書き込み', value: '禁止（送信・既読化・削除なし）' },
            ].map((row) => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{row.label}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{row.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6 }}>📋 内容</div>
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)' }}>{item.bodyPreview}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: 'var(--text-secondary)',
          letterSpacing: '0.05em',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span>{icon}</span> {title}
      </div>
      {children}
    </div>
  )
}
