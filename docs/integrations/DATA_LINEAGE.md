# DATA LINEAGE（TRACK B V1）

全レコードは以下の来歴フィールドを必須で持つ（IntegrationRecord封筒）。

| フィールド | 意味 | ルール |
|---|---|---|
| sourceSystem | 取得元システム | 例: `sheets:lcc-integrated-db` |
| sourceRecordId | 原本のID | **raw IDを振り直さない**。ID列が無い場合のみ `タブ:rowN` の位置参照 |
| sourceRecordUpdatedAt | Source側の実更新時刻 | 不明なら**null**（取得時刻で代用しない） |
| syncedAt | LCC COMMANDが取得した時刻 | 常に記録 |
| contentHash | raw内容のsha256 | 原本追跡・重複排除（idempotent同期の鍵） |
| evidence | 原本の場所 | `spreadsheet:<ID>` + `タブ!行`。秘密情報は含めない |
| freshnessStatus | 鮮度 | sourceRecordUpdatedAt不明なら**UNKNOWN**（FRESHと偽らない） |
| raw / normalized | 原文と正規化値 | 正規化は候補扱い。原文をEvidenceとして保持 |

## 現在の取込lineage（2026-08-10初回同期）

1. **LCC統合業務システムDB** → vault/raw/lcc-integrated-db.jsonl（4,825行・全タブ）
   - 既存KPI/検索系はSheetsSourceRegistry経由（customers 2,268 / projects 2,459）を継続使用。Vaultは原本追跡・将来のCanonical構築用
2. **日報データ** → vault/raw/daily-report-ai.jsonl（3,539行）
   - 確定チェック済み行のみ実績候補。未確認行はDRAFT（原価入力には使わない）
3. **LINEWORKS受信箱** → 403（SA共有待ち）。共有後は normalized.extractionCandidates（案件/依頼/期限/事故・危険/報告/決定/要確認）を決定論キーワードで付与、原文はrawに保持
4. **LCC_CASE_DB** → 403（SA共有待ち）。DERIVEDのため金額系エンジンの入力にしない
5. **TKC** → data/import/tkc/{inbox,processed,rejected}（正式exportのみ・import log付き）
6. **AI会話** → Conversation Archive（provider/conversationId/messageId/contentHash）。Memoryへは候補経由のみ

## 禁止事項

- Raw DataとMemoryの混同（全レコードをMemoryへ入れない）
- 未承認status mappingの確定事実化
- 未接続Sourceの0件・0円断定（UNKNOWNはUNKNOWNのまま表示）
