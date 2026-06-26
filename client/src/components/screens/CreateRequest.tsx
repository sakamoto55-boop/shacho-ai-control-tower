import { useState } from 'react'
import type { CreateTemplate } from '../../types'
import { createTemplates } from '../../data/mockData'

interface Props {
  onNavigateToChat: () => void
}

export default function CreateRequest({ onNavigateToChat }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState<CreateTemplate | null>(null)
  const [detail, setDetail] = useState('')

  const categories = ['すべて', '社内', '対外', 'AI指示']
  const [activeCategory, setActiveCategory] = useState('すべて')

  const filtered =
    activeCategory === 'すべて'
      ? createTemplates
      : createTemplates.filter((t) => t.category === activeCategory)

  function handleSelect(t: CreateTemplate) {
    setSelectedTemplate(t)
    setDetail('')
  }

  function handleCreate() {
    onNavigateToChat()
  }

  if (selectedTemplate) {
    return (
      <div className="screen-content">
        {/* 戻るボタン */}
        <button
          onClick={() => setSelectedTemplate(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--navy)',
            fontWeight: 700,
            fontSize: 14,
            marginBottom: 16,
            padding: '8px 0',
          }}
        >
          ← 作成メニューへ戻る
        </button>

        {/* テンプレートカード */}
        <div
          style={{
            background: 'var(--navy)',
            borderRadius: 'var(--radius)',
            padding: '20px',
            marginBottom: 20,
            color: '#fff',
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>{selectedTemplate.icon}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
            {selectedTemplate.label}
          </div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>{selectedTemplate.description}</div>
        </div>

        <div className="section-label">詳細・指示を入力</div>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder={`例: ○○さん向けに、△△の件について、□□な文面で作成してください。`}
          style={{
            width: '100%',
            minHeight: 140,
            border: '1.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            fontSize: 15,
            lineHeight: 1.6,
            resize: 'vertical',
            color: 'var(--text-primary)',
            background: '#fff',
            outline: 'none',
            marginBottom: 14,
          }}
        />

        <button
          onClick={handleCreate}
          className="btn btn-primary btn-block"
          style={{ marginBottom: 10 }}
        >
          <span>🤖</span> AIチャットで作成する
        </button>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          AIチャット画面に移動して作成します
        </div>
      </div>
    )
  }

  return (
    <div className="screen-content">
      {/* カテゴリフィルター */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 16,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          paddingBottom: 4,
        }}
      >
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              flexShrink: 0,
              padding: '8px 16px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              background: activeCategory === cat ? 'var(--navy)' : '#fff',
              color: activeCategory === cat ? '#fff' : 'var(--text-secondary)',
              border: activeCategory === cat ? 'none' : '1.5px solid var(--border)',
              boxShadow: activeCategory === cat ? 'none' : 'var(--shadow)',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* テンプレートグリッド */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}
      >
        {filtered.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t)}
            style={{
              background: '#fff',
              borderRadius: 'var(--radius)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 8,
              boxShadow: 'var(--shadow)',
              border: '2px solid transparent',
              transition: 'border-color 0.15s',
              minHeight: 110,
            }}
          >
            <span style={{ fontSize: 30 }}>{t.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--navy)', lineHeight: 1.3 }}>
              {t.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              {t.description}
            </span>
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 20,
          padding: '14px 16px',
          background: 'var(--blue-light)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 13,
          color: 'var(--navy)',
          lineHeight: 1.6,
        }}
      >
        💡 <strong>使い方：</strong> 作りたい資料を選んで、内容の詳細を入力するとAIが作成します。
      </div>
    </div>
  )
}
