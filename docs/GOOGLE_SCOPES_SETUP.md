# GOOGLE_SCOPES_SETUP.md — Google 4スコープ OAuth設定（Mission 1.3）

> Gmail / Calendar / Drive / Sheets をすべて**読み取り専用**で接続する設定手順。  
> 書き込みは一切しない。バックエンド不要・費用ゼロ。

---

## 使用スコープ（4つ・すべて readonly）

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/spreadsheets.readonly
```

> ⚠️ 書き込みスコープ（gmail.send / gmail.modify / calendar / drive / spreadsheets）は永久に追加しない。

---

## Step 1: API を有効化（Google Cloud Console）

「APIとサービス」→「ライブラリ」で以下を有効化：
- Gmail API
- Google Calendar API
- Google Drive API
- Google Sheets API

## Step 2: OAuth同意画面でスコープを追加

「OAuth同意画面」→「スコープを追加または削除」で4つの readonly を選択。
- 外部ユーザー種別の場合、社長のGoogleアカウントを「テストユーザー」に追加。

## Step 3: 環境変数（client/.env）

```env
VITE_GOOGLE_CLIENT_ID=<OAuthクライアントID>
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
VITE_GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly
```

> 既に Gmail のみで接続済みの場合は、設定画面で一度「切断」→再接続してください
> （古いトークンは gmail スコープしか持たず、Calendar/Drive/Sheets が「取得失敗」になります）。

## Step 4: 接続

設定画面 →「Googleアカウントで接続」→ 4スコープに同意 →
「SHOGUN データ接続状態」で各Providerが「実データ接続済み」になることを確認。

---

## 接続状態の見方（設定画面）

| 表示 | 意味 | 対処 |
|------|------|------|
| 実データ接続済み | 正常に実データ取得 | — |
| 設定不足 | Sheets の ID 未設定 | `.env` にシートID（`docs/SHEETS_DATA_FORMAT.md`）|
| 取得失敗（要再接続）| スコープ不足等 | 一度切断→4スコープで再接続 |
| 未接続（デモ）| 未ログイン | Googleアカウントで接続 |
| デモ（バックエンド必須）| LINE WORKS | Mission 対象外（当面デモ）|

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| Calendar/Drive が「取得失敗」 | 旧トークン（gmailのみ）。切断→再接続 |
| Sheets が「設定不足」 | `.env` にシートIDを設定 |
| `redirect_uri_mismatch` | Console と `.env` の URI を完全一致（末尾 / 含む）|
| `access_blocked` | テストユーザーに自分を追加 |
