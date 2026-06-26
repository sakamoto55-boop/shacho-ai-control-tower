import { useState, useRef, useEffect } from 'react'
import type { AiMode, ChatMessage } from '../../types'
import { aiModes, initialChatMessages, mockAiResponses } from '../../data/mockData'

interface Props {
  onVoice: () => void
}

function getMockResponse(mode: AiMode, input: string): string {
  const modeResponses = mockAiResponses[mode]
  if (!modeResponses) return mockAiResponses['secretary']['default']

  for (const [key, val] of Object.entries(modeResponses)) {
    if (key !== 'default' && input.includes(key)) return val
  }
  return modeResponses['default'] ?? mockAiResponses['secretary']['default']
}

export default function AiChat({ onVoice }: Props) {
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
