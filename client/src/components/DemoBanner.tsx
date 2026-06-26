export default function DemoBanner() {
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
