# SHEETS_DATA_FORMAT.md — Google Sheets 読み取りフォーマット（Mission 1.3）

> AI社長室が `spreadsheets.readonly` で読み取る際の、シートの列フォーマット定義。  
> 書き込みは一切しない（読み取り専用）。

---

## 対象シート（環境変数）

`client/.env` に ID を設定したシートだけが実データになります（未設定はデモ）。

| 環境変数 | 用途 | 既定の読み取り範囲 |
|---------|------|------------------|
| `VITE_GOOGLE_SHEETS_SALES_ID` | 売上・粗利 | A1:Z100 |
| `VITE_GOOGLE_SHEETS_CASHFLOW_ID` | 資金繰り・現金残高 | A1:Z14 |
| `VITE_GOOGLE_SHEETS_PROJECT_PROFIT_ID` | 案件別粗利 | A1:Z50 |
| `VITE_GOOGLE_SHEETS_RECEIVABLE_ID` | 未回収・入金予定 | A1:Z100 |
| `VITE_GOOGLE_SHEETS_PAYABLE_ID` | 支払予定・未請求 | A1:Z100 |

> ⚠️ 実際のシートID・URLはコードに書かない。`.env`（`.gitignore` 済み）のみに記載。

---

## 列フォーマット（各シート共通）

1行目はヘッダー（任意）。`metricKey` / `key` / `項目` / `キー` で始まる場合は自動スキップ。

| 列 | 項目 | 必須 | 例 |
|----|------|------|-----|
| A | metricKey（識別キー）| ✅ | `cash_balance` |
| B | metricName（表示名）| 推奨 | `現金残高` |
| C | category | 任意 | `資金繰り` |
| D | value（数値）| ✅ | `12,500,000` / `¥1,250万` / `45.2%` |
| E | unit（単位）| 任意 | `円` / `%` |
| F | period（対象期間）| 任意 | `2026-06` |
| G | status | 任意 | `normal` / `warning` / `danger`（`注意`/`危険`可）|
| H | alertReason（注意理由）| 任意 | `先月比 -300万` |

- category は次のいずれか（不一致は「その他」）：
  `売上 / 粗利 / 資金繰り / 請求 / 未回収 / 外注費 / 事故 / 稼働率 / その他`
- value は `¥ , % 空白` を自動除去して数値化。
- status が `danger`→リスク高、`warning`→リスク中 として健康度・リスク判定に反映。

---

## 記入例（売上シート）

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| metricKey | metricName | category | value | unit | period | status | alertReason |
| monthly_revenue | 今月売上 | 売上 | 18,200,000 | 円 | 2026-06 | normal | |
| gross_profit_rate | 粗利率 | 粗利 | 22.4 | % | 2026-06 | warning | 先月比 -3.1pt |
| cash_balance | 現金残高 | 資金繰り | 9,800,000 | 円 | 2026-06 | danger | 来月支払で不足懸念 |

---

## フォーマット不一致のとき

- 解析結果が0件の場合は「取得失敗」となり、デモへフォールバックします。
- 列順がこの定義と異なる場合は、シート側を本フォーマットに合わせてください。
- 数値が読めないセルは 0 として扱います。

---

## 安全性

- 読み取りは `fetchSpreadsheet` / `fetchSheetValues`（GET）のみ。
- セル更新・行追加・行削除・シート作成・共有変更は**未実装**（書き込み禁止）。
