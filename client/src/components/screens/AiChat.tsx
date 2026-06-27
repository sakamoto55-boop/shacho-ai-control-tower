import { useState, useRef, useEffect } from 'react'
import type { AiMode, ChatMessage } from '../../types'
import type { Screen } from '../../types'
import { aiModes, initialChatMessages, mockAiResponses } from '../../data/mockData'
import DemoBanner from '../DemoBanner'
import { mockCalendarEvents } from '../../services/calendar/mockCalendar'
import { mapToCalendarDerivedEvent } from '../../services/calendar/calendarMapper'
import { createCalendarSummary } from '../../services/calendar/calendarAnalyzer'

interface Props {
  onVoice: () => void
  onNavigate: (screen: Screen) => void
}

const GMAIL_SHORTCUTS = [
  'Gmailの要対応をまとめて',
  '返信が必要なメールを優先順にして',
  '銀行からのメールだけ見せて',
  '今日中に対応が必要なメールは？',
  '返信文だけ作って',
]

const CALENDAR_SHORTCUTS = [
  '今日の予定をまとめて',
  '銀行関係の予定だけ見せて',
  '今日の移動が必要な予定は？',
  '期限がある予定はどれ？',
  '予定とGmailを合わせて優先順位を出して',
]

// Calendar ショートカット回答（Schedule Provider 参照）
function getCalendarShortcutResponse(input: string): string | null {
  const calEvents = mockCalendarEvents.filter((e) => e.status !== 'cancelled')
  const derived = calEvents.map((e) => mapToCalendarDerivedEvent(e, 'demo'))
  const summary = createCalendarSummary(calEvents)

  if (input.includes('今日の予定をまとめて') || input.includes('予定をまとめて')) {
    const lines = derived.map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `・${timeStr} 【${e.importance}】${e.title}（${e.category}）`
    }).join('\n')
    return `本日の予定 ${summary.totalCount}件です。\n\n${lines}\n\n重要予定${summary.importanceACount}件、移動が必要な予定${summary.travelRequiredCount}件あります。\n\nデータ元：デモCalendar · 読み取り専用 · 予定変更なし`
  }

  if (input.includes('銀行関係') || input.includes('銀行の予定')) {
    const bank = derived.filter((e) => e.category === '銀行')
    if (bank.length === 0) return '本日は銀行関係の予定はありません。'
    const lines = bank.map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `・${timeStr} ${e.title}\n  ${e.suggestedAction ?? ''}`
    }).join('\n')
    return `銀行関係の予定 ${bank.length}件です。\n\n${lines}\n\n事前に財務資料をご確認ください。`
  }

  if (input.includes('移動') && input.includes('予定')) {
    const travel = derived.filter((e) => e.location && !e.location.includes('会議室'))
    if (travel.length === 0) return '本日は移動が必要な予定はありません。'
    const lines = travel.map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `・${timeStr} ${e.title}\n  場所：${e.location}`
    }).join('\n')
    return `移動が必要な予定 ${travel.length}件です。\n\n${lines}\n\n余裕をもって出発してください。`
  }

  if (input.includes('期限') && input.includes('予定')) {
    const deadlines = derived.filter((e) => e.deadlineRisk)
    if (deadlines.length === 0) return '本日は期限のある予定はありません。'
    const lines = deadlines.map((e) => `・${e.title}（${e.category}）\n  ${e.suggestedAction ?? '本日中に対応してください'}`).join('\n')
    return `期限のある予定 ${deadlines.length}件です。\n\n${lines}`
  }

  if (input.includes('予定とGmail') || input.includes('優先順位')) {
    const importantEvents = derived.filter((e) => e.importance === 'A' || e.deadlineRisk)
    const lines = importantEvents.slice(0, 3).map((e) => {
      const timeStr = e.isAllDay ? '終日' : new Date(e.startAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
      return `1位：${timeStr} ${e.title} — ${e.suggestedAction ?? e.category}`
    }).join('\n')
    return `Gmail × Calendar 横断優先順位です。\n\n${lines}\n\n※Gmailの銀行・行政メールと同日の予定は優先度を上げています。\nSchedule Provider + Inbox Provider 横断分析（Phase 6）`
  }

  return null
}

function getMockResponse(mode: AiMode, input: string): string {
  // カレンダーショートカット回答を優先
  const calendarResponse = getCalendarShortcutResponse(input)
  if (calendarResponse) return calendarResponse

  const modeResponses = mockAiResponses[mode]
  if (!modeResponses) return mockAiResponses['secretary']['default']

  for (const [key, val] of Object.entries(modeResponses)) {
    if (key !== 'default' && input.includes(key)) return val
  }
  return modeResponses['default'] ?? mockAiResponses['secretary']['default']
}

export default function AiChat({ onVoice, onNavigate }: Props) {
  const [activeMode, setActiveMode] = useState<AiMode>('secretary')
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  function sendMessage(text: string) {
    if (!text.trim()) return
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    setTimeout(() => {
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: getMockResponse(activeMode, text),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiMsg])
      setIsTyping(false)
    }, 1000)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function switchMode(mode: AiMode) {
    setActiveMode(mode)
    const modeConfig = aiModes.find((m) => m.id === mode)
    if (!modeConfig) return
    const switchMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: `**${modeConfig.icon} ${modeConfig.label}モードに切り替えました**\n\n${modeConfig.prompts.slice(0, 3).map((p) => `• ${p}`).join('\n')}\n\nなど、${modeConfig.label}に関することをお気軽にどうぞ。`,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, switchMsg])
  }

  const currentMode = aiModes.find((m) => m.id === activeMode)!
  const prompts = currentMode.prompts

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ── AIモードタブバー ── */}
      <div
        ref={tabBarRef}
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          padding: '10px 14px 4px',
          borderBottom: '1px solid var(--border)',
          background: '#fff',
        }}
      >
        {aiModes.map((m) => {
          const isActive = m.id === activeMode
          return (
            <button
              key={m.id}
              onClick={() => switchMode(m.id)}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '8px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                background: isActive ? m.color : 'var(--bg)',
                color: isActive ? '#fff' : 'var(--text-secondary)',
                border: isActive ? 'none' : '1.5px solid var(--border)',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Gmailショートカット ── */}
      <div
        style={{
          flexShrink: 0,
          background: '#EFF6FF',
          borderBottom: '1px solid #BFDBFE',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#1D4ED8', marginBottom: 4 }}>
          📧 Gmailショートカット
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {GMAIL_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #BFDBFE',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#1D4ED8',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── カレンダーショートカット（Phase 6）── */}
      <div
        style={{
          flexShrink: 0,
          background: '#F0FDF4',
          borderBottom: '1px solid #BBF7D0',
          padding: '6px 14px',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, color: '#166534', marginBottom: 4 }}>
          📅 カレンダーショートカット
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}
        >
          {CALENDAR_SHORTCUTS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                flexShrink: 0,
                background: '#fff',
                border: '1.5px solid #BBF7D0',
                borderRadius: 999,
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: '#166534',
                whiteSpace: 'nowrap',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── プロンプト例（横スクロール） ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          padding: '8px 14px 6px',
          background: 'var(--bg)',
        }}
      >
        {prompts.map((s) => (
          <button
            key={s}
            onClick={() => sendMessage(s)}
            style={{
              flexShrink: 0,
              background: '#fff',
              border: `1.5px solid ${currentMode.color}30`,
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: currentMode.color,
              whiteSpace: 'nowrap',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── メッセージリスト ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          scrollbarWidth: 'none',
        }}
      >
        <DemoBanner />
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} modeColor={currentMode.color} />
        ))}
        {isTyping && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <AiAvatar icon={currentMode.icon} color={currentMode.color} />
            <div
              style={{
                background: '#fff',
                borderRadius: '18px 18px 18px 4px',
                padding: '12px 16px',
                boxShadow: 'var(--shadow)',
                display: 'flex',
                gap: 5,
                alignItems: 'center',
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    background: currentMode.color,
                    borderRadius: '50%',
                    animation: `chatBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── 入力エリア ── */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px calc(var(--nav-height) + var(--safe-bottom) + 10px)',
          background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => onNavigate('create')}
          style={{
            width: '100%',
            marginBottom: 8,
            padding: '9px 14px',
            borderRadius: 12,
            background: '#FFF7ED',
            border: '1.5px solid #FED7AA',
            color: '#C2410C',
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          ✍️ 作成依頼へ（文書・返信・指示文）
        </button>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            background: '#fff',
            borderRadius: 24,
            padding: '8px 8px 8px 16px',
            boxShadow: 'var(--shadow-md)',
            border: `1.5px solid ${currentMode.color}30`,
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`${currentMode.icon} ${currentMode.label}に聞く...`}
            rows={1}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: 15,
              lineHeight: 1.5,
              maxHeight: 100,
              background: 'transparent',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={onVoice}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
              color: 'var(--text-secondary)',
            }}
          >
            🎤
          </button>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: input.trim() ? currentMode.color : 'var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
              color: '#fff',
              transition: 'background 0.2s',
            }}
          >
            ↑
          </button>
        </div>
      </div>

      <style>{`
        @keyframes chatBounce {
          0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function AiAvatar({ icon, color }: { icon: string; color: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
  )
}

function ChatBubble({ message, modeColor }: { message: ChatMessage; modeColor: string }) {
  const isUser = message.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 10,
        alignItems: 'flex-end',
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: modeColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          🤖
        </div>
      )}
      <div
        style={{
          maxWidth: '78%',
          background: isUser ? modeColor : '#fff',
          color: isUser ? '#fff' : 'var(--text-primary)',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '11px 15px',
          fontSize: 14,
          lineHeight: 1.65,
          boxShadow: 'var(--shadow)',
          whiteSpace: 'pre-wrap',
        }}
        dangerouslySetInnerHTML={{
          __html: message.content
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br />'),
        }}
      />
    </div>
  )
}
