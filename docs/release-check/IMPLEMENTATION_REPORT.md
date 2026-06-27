# IMPLEMENTATION_REPORT.md — 実装内容・未実装項目・注意点

> 最終更新: Phase 5 — v0.5.0（2026-06-27）

---

## Phase 5 実装内容

### ① OAuth 構造 ✅ 完了

```
client/src/services/google/
├── googleAuth.ts      Authorization Code + PKCE フロー
├── googleToken.ts     トークン管理・有効性確認・自動リフレッシュ
├── googleSession.ts   セッション状態（未接続/接続中/接続済み/エラー）
├── googleScopes.ts    スコープ定数（Phase 5: gmail.readonly のみ）
├── googleErrors.ts    GoogleAuthError クラス（8種コード）
└── googleStorage.ts   localStorage/sessionStorage ラッパー（トークン・PKCE・キャッシュ・ログ）
```

### ② 認証画面（設定画面 Google 接続カード）✅ 完了

表示する状態:
- `□ 未接続` — トークンなし
- `⏳ 接続中...` — OAuth フロー中 or コールバック処理中
- `✓ 接続済み` — トークン有効
- `✗ エラー` — 認証失敗・state不一致等

表示する情報:
- 接続中のメールアドレス
- 取得済み権限（✓ Gmail 読み取り専用）
- 未取得権限（calendar.readonly / drive.readonly / sheets.readonly → Phase 6以降）
- 書き込み禁止バナー
- 認証ログ（折りたたみ表示）

### ③ Gmail 取得フロー ✅ 構造完成（本番接続はClientID設定後）

```
googleAuth.startOAuthFlow()
 → Google 認証画面
 → コールバック ?code=...&state=...
 → App.tsx useEffect で検知
 → googleAuth.handleCallback(code, state)
 → トークン取得・保存
 → 設定画面「接続済み」表示
 → fetchRawMessages() → gmailFetcher.fetchMessages(accessToken)
 → gmailCache.set() → 5分間キャッシュ
```

### ④ Gmail 取得項目 ✅ 完了（gmailFetcher.ts）

取得項目:
- `messageId` (`id`)
- `threadId`
- `from` (表示名) / `fromEmail` (メールアドレス)
- `subject`
- `date` (`internalDate` から変換)
- `snippet`
- `labels` (`labelIds`)
- `hasAttachment` (parts[].filename で確認)
- `bodyText` (text/plain パートを base64 decode)

### ⑤ AI判定 ✅ 構造完成（gmailAnalyzer.ts は差し替え可能）

`gmailAnalyzer.ts` で以下を判定:
- 優先度: A / B / C
- カテゴリ: 銀行 / 事故 / 請求 / 契約 / 営業 / 福祉 / その他
- 期限キーワード: 本日中 / 今日中 / 至急 / 緊急 / 即日

本番 AI 判定への差し替えポイント:
```typescript
// gmailAnalyzer.ts の analyzeTaskType() / analyzePriority() を
// Claude API 等のリアルタイム判定に置き換えるだけで全画面に反映される
```

### ⑥ キャッシュ ✅ 完了（gmailCache.ts）

- 有効期限: 5分
- 保存先: localStorage
- `gmailCache.isStale()` が true の場合のみ API 呼び出し
- 手動リフレッシュ: `refreshMessages()` → キャッシュクリア後に再取得
- `gmailCache.getLastFetchedAt()` で最終取得日時を取得可能

### ⑦ AIブリーフィング ✅ 構造完成（briefingGenerator.ts）

`generateBriefingFromMessages(messages: GmailMessage[])` を作成。  
実データが届けばホームのブリーフィングカードを差し替えられる構造。  
現時点は mockData.ts の `todayBriefing` を使用中（接続後に切り替え可能）。

### ⑧ 安全設計 ✅ 完了

書き込み API の未実装を確認（SAFETY_REPORT.md 参照）。

### ⑨ ログ ✅ 完了（googleStorage.ts + gmailFetcher.ts）

記録イベント: `oauth_start` / `oauth_success` / `oauth_error` / `token_refresh` / `fetch_start` / `fetch_success` / `fetch_error` / `disconnect`

### ⑩ .env.example ✅ 完了（client/.env.example）

```env
VITE_GMAIL_CLIENT_ID=
VITE_GMAIL_CLIENT_SECRET=
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
VITE_GOOGLE_READONLY_SCOPE=https://www.googleapis.com/auth/gmail.readonly
```

### ⑪ README ✅ 完了

Phase 5 セクション追加（OAuth構造・フロー図・書き込みなし証拠表）。

---

## 未実装項目（意図的に保留）

| 項目 | 保留理由 |
|------|---------|
| 本番 Gmail API への実接続 | `VITE_GMAIL_CLIENT_ID` が未設定。設定後は即時動作。 |
| バックエンド Proxy 経由のトークン交換 | SPA で直接トークン交換するため client_secret がフロントに露出する点の改善（Phase 6 以降） |
| アクセストークンの自動リフレッシュ UI 表示 | 内部では `googleToken.refresh()` が実装済み。画面表示は未追加。 |
| Googleカレンダー ReadOnly | Phase 6 予定 |
| Google Drive / Sheets | 未定 |
| LINE WORKS | 未定 |

## 注意点

### ClientID の設定について
`client/.env.example` をコピーして `client/.env` を作成し、Google Cloud Console で発行した Client ID を設定してください。  
`VITE_` プレフィックスが必要です（Vite ビルドツールの仕様）。

### リダイレクト URI の一致
`VITE_GOOGLE_REDIRECT_URI` の値が Google Cloud Console の「承認済みリダイレクト URI」と完全一致している必要があります。  
ポート番号を含めて一致させてください（例: `http://localhost:5173/`）。

### SPA での PKCE トークン交換
現実装は SPA から直接 `https://oauth2.googleapis.com/token` を呼ぶ構造です。  
Google の Desktop App タイプの OAuth クライアントを使用すれば client_secret なしで動作します。  
Web App タイプの場合は client_secret が必要になりますが、SPA に含めることはセキュリティ上推奨されません。  
本番環境では Node.js バックエンドを経由したトークン交換を推奨します。
