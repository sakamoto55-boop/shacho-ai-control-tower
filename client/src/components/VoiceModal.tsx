interface Props {
  onClose: () => void
}

export default function VoiceModal({ onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: '#fff',
          borderRadius: '28px 28px 0 0',
          padding: '24px 24px calc(env(safe-area-inset-bottom, 0px) + 32px)',
          textAlign: 'center',
        }}
      >
        {/* ハンドル */}
        <div
          style={{
            width: 40,
            height: 4,
            background: '#E2E8F0',
            borderRadius: 4,
            margin: '0 auto 24px',
          }}
        />

        {/* マイクアイコン（アニメーション） */}
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            fontSize: 40,
            boxShadow: '0 0 0 12px rgba(27,61,111,0.1), 0 0 0 24px rgba(27,61,111,0.05)',
          }}
        >
          🎤
        </div>

        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--navy)',
            marginBottom: 10,
          }}
        >
          音声入力
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--warning-light)',
            color: '#92400E',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 700,
            marginBottom: 18,
          }}
        >
          <span>🔧</span> 接続準備中
        </div>

        <div
          style={{
            background: 'var(--bg)',
            borderRadius: 16,
            padding: '18px',
            marginBottom: 24,
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 10 }}>
            将来のできること
          </div>
          {[
            '🎤  話しかけるだけでAIが内容を整理',
            '📝  返信文・資料をその場で作成',
            '📊  経営状況を音声で即確認',
            '🔔  重要事項をリアルタイムで要約',
          ].map((t) => (
            <div
              key={t}
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                padding: '5px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {t}
            </div>
          ))}
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 10,
              lineHeight: 1.6,
            }}
          >
            Web Speech API または音声認識サービスとの接続後に使用可能になります。
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            minHeight: 52,
            borderRadius: 16,
            background: 'var(--navy)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  )
}
