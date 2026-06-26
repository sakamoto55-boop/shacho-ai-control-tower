import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../../types'
import { initialChatMessages, promptSuggestions } from '../../data/mockData'

const MOCK_RESPONSES: Record<string, string> = {
  default:
    '承知しました。現在はMVPモードのため、実際のAI応答はまだ接続されていません。\n\nClaude APIと接続後は、メール内容の要約・返信文作成・タスク整理など、リアルタイムでサポートします。\n\n**今後の連携予定：**\n• Claude API (claude-opus-4-8)\n• Gmail API\n• LINE WORKS API\n• Google Drive API',
  メール:
    '**昨日の重要メール（仮データ）：**\n\n🔴 田中建設 田中部長\n「工事代金未払い件について至急連絡ください」\n→ 本日17時まで要返信\n\n🟡 三菱UFJ銀行 佐藤担当\n「融資審査書類の追加提出依頼」\n→ 本日中に書類準備\n\n🟡 山田様（個人）\n「新規案件見積もり依頼（戸建てリフォーム）」\n→ 今週中に見積作成',
  今日: '**今日のやるべきこと：**\n\n✅ 最優先（午前中に）\n1. 田中建設への返信\n2. 銀行書類の準備・送付\n3. 現場事故の状況確認\n\n📋 午後\n4. freee請求書確認\n5. 外注見積もり確認\n\n📝 今週中\n6. 戸建てリフォーム見積作成\n7. 社員研修日程の承認',
  返信:
    '**返信文案（田中建設 田中部長あて）：**\n\n---\n田中部長\n\nお世話になっております。坂本でございます。\nご連絡をいただきありがとうございます。\n\n工事代金の件につきまして、確認の上、本日中にご連絡させていただきます。\nご迷惑をおかけしており、誠に申し訳ございません。\n\n何卒よろしくお願いいたします。\n\nLCC株式会社\n代表取締役 坂本\n---\n\nこの文面でよろしければ、コピーしてご使用ください。',
}

function getMockResponse(input: string): string {
  if (input.includes('メール') || input.includes('まとめ')) return MOCK_RESPONSES['メール']
  if (input.includes('今日') || input.includes('やるべき')) return MOCK_RESPONSES['今日']
  if (input.includes('返信')) return MOCK_RESPONSES['返信']
  return MOCK_RESPONSES['default']
}

export default function AiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
        content: getMockResponse(text),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, aiMsg])
      setIsTyping(false)
    }, 1200)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* プロンプト例（横スクロール） */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px 6px',
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        {promptSuggestions.map((s) => (
          <button
            key={s}
            onClick={() => sendMessage(s)}
            style={{
              flexShrink: 0,
              background: '#fff',
              border: '1.5px solid var(--border)',
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--navy)',
              whiteSpace: 'nowrap',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* メッセージリスト */}
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
          <ChatBubble key={msg.id} message={msg} />
        ))}
        {isTyping && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <AiAvatar />
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
                    background: 'var(--text-muted)',
                    borderRadius: '50%',
                    animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 入力エリア */}
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
            border: '1.5px solid var(--border)',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="社長、何でもどうぞ..."
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
          {/* 音声入力ボタン風 */}
          <button
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
          {/* 送信ボタン */}
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: input.trim() ? 'var(--navy)' : 'var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0,
              transition: 'background 0.2s',
            }}
          >
            ↑
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function AiAvatar() {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--navy)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      🤖
    </div>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
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
      {!isUser && <AiAvatar />}
      <div
        style={{
          maxWidth: '78%',
          background: isUser ? 'var(--navy)' : '#fff',
          color: isUser ? '#fff' : 'var(--text-primary)',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '11px 15px',
          fontSize: 14,
          lineHeight: 1.6,
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
