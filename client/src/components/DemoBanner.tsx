import { googleToken } from '../services/google/googleToken'

// Google接続時は「実データ（読み取り専用）」、未接続時は「デモ」を明示する。
// デモを本番情報のように見せない／接続後はデモ表示を出さない。
export default function DemoBanner() {
  const connected = googleToken.hasToken()

  if (connected) {
    return (
      <div
        style={{
          background: '#ECFDF5',
          border: '1px solid #A7F3D0',
          borderRadius: 8,
          padding: '5px 12px',
          fontSize: 10,
          color: '#065F46',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 10,
        }}
      >
        <span>✅</span>
        <span>Google接続中 — 実データ（読み取り専用）· 書き込みなし</span>
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#FEF9C3',
        border: '1px solid #FDE68A',
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 10,
        color: '#92400E',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginBottom: 10,
      }}
    >
      <span>⚠️</span>
      <span>現在はデモデータ表示中 — 外部サービス未接続 · 書き込みなし</span>
    </div>
  )
}
