# PROJECT SHOGUN — Google Providers Real Data（Mission 1.3）

> Overnight Review / Morning Briefing に使う Google系データを実データ化する。  
> LINE WORKS は当面デモのまま。外部書き込み・有料リソースは作らない。  
> 2026-06-28

---

## 対象と接続方式

| Provider | 接続 | スコープ | データ元（接続時 / 未接続） |
|---------|------|---------|--------------------------|
| Gmail | ✅ 実データ | `gmail.readonly` | Gmail API / mockGmail |
| Calendar | ✅ 実データ | `calendar.readonly` | Calendar API / mockCalendar |
| Drive | ✅ 実データ | `drive.readonly` | Drive API / mockDrive |
| Sheets | ✅ 実データ（ID設定時）| `spreadsheets.readonly` | Sheets API / mockSheets |
| LINE WORKS | ❌ デモ | — | mockLineworks（バックエンド必須）|

---

## データフロー（Provider → AI Engine → チャット）

```
各クライアント（接続時=実データ / 未接続・失敗=デモ）
  ├ gmailClient.fetchRawMessages()       → Gmail API（newer_than:1d, GET）
  ├ calendarClient.fetchEvents()          → Calendar API（今日〜+7日, GET）
  ├ driveClient.fetchFiles()              → Drive API（最近更新50件, GET）
  ├ sheetsClient.fetchDataset()           → Sheets API（設定シートのみ, GET）
  └ lineworksClient.fetchNotifications()  → mock（デモ固定）
        ↓ aiOrchestrator.load*Items()（Unified型へ変換 + source判定）
        ↓ assembleOrchestratorResult()（横断・優先度・健康度・決断）
        ↓ morningBriefingEngine（夜間レビュー / 5カテゴリ / 返信状況）
        ↓ AiChat（チャットに順次反映・データ取得状況を表示）
```

各Providerは取得完了した順に Morning Briefing へ反映される（Mission 1.1）。

---

## データ取得状況の表示

Morning Briefing 末尾（締めの直前）に表示：

```
📡 データ：受信箱=実データ / 予定=実データ / ファイル=実データ / 数字=未設定 / 通知=デモ
残りは私が監視します。
```

| 表示 | 意味 |
|------|------|
| 実データ | api/cache から取得（本番データ）|
| 取得中 | 取得処理中 |
| 未設定 | Sheets ID 未設定（spreadsheets接続済みでもID無し）|
| 取得失敗 | API エラー（スコープ不足・権限等）→ デモへフォールバック |
| デモ | 未接続 or LINE WORKS |

---

## 安全設計（Mission 1.3）

- 使用スコープは4つすべて **readonly**（`GOOGLE_REAL_SCOPES`）。書き込みスコープは含まない。
- 各 fetcher は **GET のみ**。送信・作成・更新・削除・共有変更・既読化は未実装。
- Sheets は GET（`fetchSpreadsheet` / `fetchSheetValues`）のみ。セル更新・行追加・削除なし。
- バックエンド / Cloud Run / Firebase / 外部DB / Webhook本番受信は作らない。
- 実シートID・URL・client_secret はコードに書かない（`.env` のみ、`.gitignore` 済み）。
- 取得データは表示・AI判定のみ。外部への書き込みなし。

---

## 関連ドキュメント
- `docs/GOOGLE_SCOPES_SETUP.md` — 4スコープのOAuth設定手順
- `docs/SHEETS_DATA_FORMAT.md` — Sheets の読み取りフォーマット
- `docs/release-check/SAFETY_REPORT.md` — 安全確認
- `docs/release-check/PRODUCTION_SECURITY_CHECK.md` — 本番接続セキュリティ
