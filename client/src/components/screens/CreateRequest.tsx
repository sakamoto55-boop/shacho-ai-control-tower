import { useState } from 'react'
import type { CreateTemplate, CreationFormData, OutputFormat } from '../../types'
import { createTemplates } from '../../data/mockData'

interface Props {
  onNavigateToChat: () => void
}

const OUTPUT_FORMATS: { id: OutputFormat; label: string; icon: string; note: string }[] = [
  { id: 'chat', label: 'チャットに表示', icon: '💬', note: '今すぐAIが生成' },
  { id: 'gmail-draft', label: 'Gmail下書き予定', icon: '📧', note: 'Gmail連携後に対応' },
  { id: 'drive', label: 'Google Drive保存予定', icon: '📁', note: 'Drive連携後に対応' },
  { id: 'manus', label: 'Manus指示文', icon: '🤖', note: 'Manusへそのまま貼り付け' },
  { id: 'claude-code', label: 'Claude Code指示文', icon: '💻', note: 'Claude Codeへ貼り付け' },
  { id: 'gemini', label: 'Gemini指示文', icon: '✨', note: 'Geminiへ貼り付け' },
]

const TONE_OPTIONS = ['丁寧・フォーマル', 'ビジネス標準', '簡潔・率直', '柔らかい・親しみやすい', '強調・インパクト重視']

const MOCK_RESULTS: Record<string, string> = {
  c1: `【社内連絡文 — 仮生成サンプル】

各位

お疲れ様です。坂本です。

以下のとおりご連絡いたします。

件名：○○について

内容：
・△△を実施します
・担当者は各自ご確認ください
・不明点は坂本まで

以上、よろしくお願いします。`,
  c2: `【返信文 — 仮生成サンプル】

○○様

お世話になっております。LCC株式会社 坂本でございます。
この度はご連絡いただきありがとうございます。

ご要望の件、承知いたしました。
詳細をご確認の上、改めてご連絡いたします。

何卒よろしくお願いいたします。

LCC株式会社 代表取締役 坂本`,
  c3: `【銀行向け資料 — 構成案（仮）】

■ 表紙
　会社概要・資料目的

■ 1. 会社概要
　・設立：令和〇年〇月
　・事業内容：建設リフォーム・外構工事
　・資本金：〇〇〇万円

■ 2. 財務状況（直近3期）
　・売上推移
　・粗利率の変化
　・借入状況

■ 3. 資金用途
　・用途の明確化
　・返済計画

■ 4. 今後の見通し
　・受注パイプライン
　・成長戦略

※ 実際の数値は顧問税理士・freeeと連携の上で入力してください。`,
  default: `【作成結果 — 仮生成サンプル】

ご指定の内容で作成しました。

※ この出力は仮データです。
Claude API接続後は、入力された背景・目的・相手に合わせてリアルタイムで最適な文章を生成します。

入力フォームの内容をもとに、精度の高い文章・資料を作成することができます。`,
}

export default function CreateRequest({ onNavigateToChat }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState<CreateTemplate | null>(null)
  const [form, setForm] = useState<CreationFormData>({
    purpose: '',
    recipient: '',
    background: '',
    content: '',
    tone: 'ビジネス標準',
    outputFormat: 'chat',
  })
  const [generatedResult, setGeneratedResult] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState('すべて')

  const categories = ['すべて', '社内', '対外', 'AI指示']
  const filtered =
    activeCategory === 'すべて'
      ? createTemplates
      : createTemplates.filter((t) => t.category === activeCategory)

  function handleGenerate() {
    const result =
      MOCK_RESULTS[selectedTemplate?.id ?? ''] ?? MOCK_RESULTS['default']
    setGeneratedResult(result)
  }

  function updateForm(key: keyof CreationFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  if (generatedResult && selectedTemplate) {
    return (
      <div className="screen-content">
        <button
          onClick={() => setGeneratedResult(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--navy)',
            fontWeight: 700,
            fontSize: 14,
            marginBottom: 14,
            padding: '8px 0',
          }}
        >
          ← フォームに戻る
        </button>

        <div
          style={{
            background: 'var(--navy)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            marginBottom: 14,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 24 }}>{selectedTemplate.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{selectedTemplate.label}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>仮生成結果（APIキー不要のサンプル）</div>
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '18px',
            fontSize: 14,
            lineHeight: 1.8,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            marginBottom: 14,
            boxShadow: 'var(--shadow)',
          }}
        >
          {generatedResult}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => navigator.clipboard?.writeText(generatedResult)}
            style={{
              minHeight: 48,
              borderRadius: 14,
              background: 'var(--navy)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            📋 コピーする
          </button>
          <button
            onClick={onNavigateToChat}
            style={{
              minHeight: 48,
              borderRadius: 14,
              background: 'var(--blue-light)',
              color: 'var(--navy)',
              fontSize: 15,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            🤖 AIチャットで詳細を相談する
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            background: 'var(--warning-light)',
            borderRadius: 12,
            fontSize: 12,
            color: '#92400E',
            lineHeight: 1.6,
          }}
        >
          💡 この出力は仮データです。Claude API接続後は、入力された情報をもとにリアルタイムで最適な文章を生成します。
        </div>
      </div>
    )
  }

  if (selectedTemplate) {
    return (
      <div className="screen-content">
        <button
          onClick={() => { setSelectedTemplate(null); setGeneratedResult(null) }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--navy)',
            fontWeight: 700,
            fontSize: 14,
            marginBottom: 14,
            padding: '8px 0',
          }}
        >
          ← 作成メニューへ戻る
        </button>

        {/* テンプレートヘッダー */}
        <div
          style={{
            background: 'var(--navy)',
            borderRadius: 'var(--radius)',
            padding: '16px',
            marginBottom: 18,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 32 }}>{selectedTemplate.icon}</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{selectedTemplate.label}</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{selectedTemplate.description}</div>
          </div>
        </div>

        {/* フォーム */}
        <FormField label="作成目的" required>
          <textarea
            value={form.purpose}
            onChange={(e) => updateForm('purpose', e.target.value)}
            placeholder="例：銀行融資の審査に通るための信頼性の高い資料を作りたい"
            rows={2}
            style={textareaStyle}
          />
        </FormField>

        <FormField label="相手・宛先">
          <input
            value={form.recipient}
            onChange={(e) => updateForm('recipient', e.target.value)}
            placeholder="例：三菱UFJ銀行 佐藤担当、田中建設 田中部長"
            style={inputStyle}
          />
        </FormField>

        <FormField label="背景・経緯">
          <textarea
            value={form.background}
            onChange={(e) => updateForm('background', e.target.value)}
            placeholder="例：先週の銀行面談で追加書類が必要と言われた。融資額は3,000万円。"
            rows={2}
            style={textareaStyle}
          />
        </FormField>

        <FormField label="入れたい内容">
          <textarea
            value={form.content}
            onChange={(e) => updateForm('content', e.target.value)}
            placeholder="例：直近3ヶ月の売上実績、今後の受注見込み、返済計画"
            rows={3}
            style={textareaStyle}
          />
        </FormField>

        <FormField label="希望トーン">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => updateForm('tone', t)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  background: form.tone === t ? 'var(--navy)' : '#fff',
                  color: form.tone === t ? '#fff' : 'var(--text-secondary)',
                  border: form.tone === t ? 'none' : '1.5px solid var(--border)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="出力形式">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {OUTPUT_FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => updateForm('outputFormat', f.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: form.outputFormat === f.id ? 'var(--blue-light)' : '#fff',
                  border: form.outputFormat === f.id ? '2px solid var(--navy)' : '1.5px solid var(--border)',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 20 }}>{f.icon}</span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: form.outputFormat === f.id ? 'var(--navy)' : 'var(--text-primary)',
                    }}
                  >
                    {f.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.note}</div>
                </div>
                {form.outputFormat === f.id && (
                  <span style={{ color: 'var(--navy)', fontWeight: 800 }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </FormField>

        <button
          onClick={handleGenerate}
          style={{
            width: '100%',
            minHeight: 54,
            borderRadius: 16,
            background: 'var(--navy)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 6,
            marginBottom: 20,
          }}
        >
          🤖 AIで作成する
        </button>
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
          marginBottom: 14,
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {filtered.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedTemplate(t)}
            style={{
              background: '#fff',
              borderRadius: 'var(--radius)',
              padding: '18px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 8,
              boxShadow: 'var(--shadow)',
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
          marginTop: 18,
          padding: '14px 16px',
          background: 'var(--blue-light)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 13,
          color: 'var(--navy)',
          lineHeight: 1.6,
        }}
      >
        💡 作りたい資料を選んで詳細を入力すると、AIが作成します。Claude API連携後は精度が大幅に向上します。
      </div>
    </div>
  )
}

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 6,
        }}
      >
        {label}
        {required && (
          <span style={{ color: '#EF4444', marginLeft: 4, fontSize: 11 }}>必須</span>
        )}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1.5px solid var(--border)',
  borderRadius: 12,
  padding: '12px 14px',
  fontSize: 15,
  color: 'var(--text-primary)',
  background: '#fff',
  outline: 'none',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  border: '1.5px solid var(--border)',
  borderRadius: 12,
  padding: '12px 14px',
  fontSize: 15,
  lineHeight: 1.6,
  resize: 'vertical',
  color: 'var(--text-primary)',
  background: '#fff',
  outline: 'none',
}
