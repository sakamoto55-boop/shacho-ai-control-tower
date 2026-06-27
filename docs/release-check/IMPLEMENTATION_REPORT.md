# IMPLEMENTATION_REPORT.md — 実装内容・未実装項目・注意点

> 最終更新: Phase 6 — v0.6.0（2026-06-27）

---

## Phase 6 実装内容

### ① Calendar サービス層 ✅ 完了（client/src/services/calendar/ — 7ファイル）

| ファイル | 状態 |
|---------|------|
| `types.ts` | 完了（GoogleCalendarEvent / CalendarDerivedEvent / CalendarSummary） |
| `mockCalendar.ts` | 完了（銀行打合せ・現場確認・行政書類・運営確認等 5件） |
| `calendarClient.ts` | 完了（mock/cache/API 切り替え、書き込みなし） |
| `calendarFetcher.ts` | 完了（GET 専用、書き込みAPI未実装） |
| `calendarMapper.ts` | 完了（GoogleCalendarEvent → CalendarDerivedEvent → UnifiedScheduleItem） |
| `calendarAnalyzer.ts` | 完了（10種カテゴリ・重要度A/B/C・期限リスク・CalendarSummary） |
| `calendarCache.ts` | 完了（5分 TTL、localStorage、isStale/getLastFetchedAt） |

### ② Scope 管理更新 ✅ 完了

- `GOOGLE_SCOPES.CALENDAR_READONLY` を追加
- `PHASE6_SCOPES` を追加（gmail.readonly + calendar.readonly）
- `FORBIDDEN_SCOPES` を定義（書き込みスコープリスト）
- `hasWriteScope()` 関数を追加

### ③ UnifiedScheduleItem 拡張 ✅ 完了

11フィールドを追加: description / attendees / calendarName / category / relatedCompany / relatedPerson / deadlineRisk / suggestedAction / readOnly: true / writeEnabled: false

### ④ Schedule Provider 接続 ✅ 完了

- `scheduleProvider.ts`: stub → Google Calendar ReadOnly 実装
- `connectionStatus`: `googleToken.hasToken()` で動的決定（接続済み / 未接続）
- デモモード: 認証なしは mockCalendarEvents を返す

### ⑤ AI Engine 横断連携 ✅ 完了

- `priorityEngine.ts`: Inbox × Schedule 横断スコアリング（同日同カテゴリ +20、関連予定最重要 +10）
- `briefingEngine.ts`: Schedule セクション追加（generateSections に schedule 引数追加）、横断アクション生成

### ⑥ 画面反映 ✅ 完了

| 画面 | 変更内容 |
|------|---------|
| `CockpitScreen.tsx` | 今日の予定セクション追加（重要/移動/期限/銀行カウント + 予定リスト5件） |
| `Home.tsx` | 今日の予定カード追加（件数/重要/移動/期限 + 次の予定表示） |
| `AiChat.tsx` | カレンダーショートカット追加（5種）+ 回答ロジック（Schedule Provider 参照） |
| `Settings.tsx` | Phase 6 表記・v0.6.0 バージョン更新 |

### ⑦ ドキュメント ✅ 完了

- `docs/release-check/CALENDAR_READONLY_DESIGN.md`: 新規作成（Calendar 設計書）
- `docs/release-check/` 全 10 ファイル: Phase 6 内容に更新
- `README.md`: Phase 6 セクション追加

### ⑧ バージョン更新 ✅ 完了 → v0.6.0

---

## Phase 5.5 実装内容

### ① Provider層 ✅ 完了（client/src/core/providers/ — 9ファイル）

| Provider | ファイル | 状態 |
|---------|---------|------|
| 統合型定義 | `providerTypes.ts` | 完了（9統合型） |
| Inbox Provider | `inboxProvider.ts` | 完了（Gmail → UnifiedInboxItem） |
| Schedule Provider | `scheduleProvider.ts` | stub（Phase 6: Calendar） |
| File Provider | `fileProvider.ts` | stub（将来: Drive） |
| BusinessData Provider | `businessDataProvider.ts` | stub（将来: Sheets/freee/TKC） |
| Workflow Provider | `workflowProvider.ts` | stub（将来: 承認フロー） |
| Notification Provider | `notificationProvider.ts` | stub（将来: アラート） |
| Provider Registry | `providerRegistry.ts` | 完了（全Provider管理窓口） |
| Provider Health | `providerHealth.ts` | 完了（健全性チェック） |

### ② AI Engine層 ✅ 完了（client/src/core/ai-engine/ — 8ファイル）

| エンジン | ファイル | 状態 |
|---------|---------|------|
| 共通型 | `aiEngineTypes.ts` | 完了 |
| Normalizer | `normalizer.ts` | 完了（Gmail → UnifiedInboxItem、将来プレースホルダーあり） |
| PriorityEngine | `priorityEngine.ts` | 完了（スコアリング0-100・ランキング） |
| BriefingEngine | `briefingEngine.ts` | 完了（受信・リスク・アクションセクション） |
| RiskEngine | `riskEngine.ts` | 完了（キーワード検知・BusinessData検知） |
| ActionEngine | `actionEngine.ts` | 完了（提案のみ・外部実行なし） |
| SearchEngine | `searchEngine.ts` | 完了（インボックス検索・将来横断予定） |
| ApprovalEngine | `approvalEngine.ts` | 完了（承認ゲート・書き込み禁止） |

### ③ 設定画面 AI社長室データ基盤カード ✅ 完了

- Provider一覧を表示（Inbox/Schedule/File/BusinessData/Workflow/Notification）
- 各Providerの接続状態・読み取り専用・書き込み禁止・次フェーズを表示
- `providerHealth.getSummary()` で全体健全性を表示

### ④ ドキュメント ✅ 完了

- `ARCHITECTURE_OVERVIEW.md`: 4レイヤー構成図・Provider別接続状況
- `PROVIDER_DESIGN.md`: Provider設計仕様・統合型一覧・追加手順
- `AI_ENGINE_DESIGN.md`: エンジン入出力・Claude API接続ポイント

### ⑤ バージョン更新 ✅ 完了 → v0.5.5

---

## Phase 5.1 実装内容

### ① OAuth 接続前チェック機能 ✅ 完了（googleConfig.ts）

```
getOAuthPreConnectCheck() が返す情報：
  hasClientId         VITE_GOOGLE_CLIENT_ID の設定有無
  hasRedirectUri      VITE_GOOGLE_REDIRECT_URI の設定有無と現在値
  scope               現在設定されているスコープ文字列
  isReadOnly          常に true（設計上）
  hasWriteScope       常に false（書き込みスコープ取得禁止）
  writeApiImplemented 常に false（書き込み API 未実装）
  isReadyToConnect    hasClientId && hasRedirectUri
  clientIdMasked      末尾8文字のみ表示（XSS 対策）
```

### ② 接続前チェック UI ✅ 完了（Settings.tsx）

未接続時のみ表示されるパネル「🔍 接続前チェック」:

| 項目 | 設定なし | 設定済み |
|------|---------|---------|
| Client ID設定 | ❌ 未設定（赤） | ✅ ****XXXXXXXX（緑） |
| Redirect URI設定 | ❌ 未設定（赤） | ✅ http://localhost:5173/（緑） |
| スコープ | ✅ gmail.readonly のみ（緑・常時） | — |
| 書き込みAPI | ✅ 未実装（緑・常時） | — |
| 本番接続準備 | ❌ 未完了（赤） | ✅ 完了（緑） |

### ③ OAUTH_SECURITY_REVIEW.md ✅ 完了

スコープ検証・書き込み API 不在・トークン保存場所・トークン期限・ログアウト挙動・エラー処理・SPA リスク・本番化前注意事項を文書化。

### ④ GOOGLE_CONNECT_CHECKLIST.md ✅ 完了

Google Cloud Console の Step 1〜8（プロジェクト作成 → API 有効化 → OAuth 同意画面 → クライアント ID 作成 → 環境変数設定 → 接続前チェック → 接続テスト → 安全確認）を手順書化。

### ⑤ README SPA OAuth リスクセクション ✅ 完了

- SPA における OAuth の制約（client_secret 不使用・localStorage リスク・VITE_ 変数のバンドル）
- 絶対に行ってはいけないこと（.env コミット禁止・client_secret 埋め込み禁止等）
- 本番推奨アーキテクチャ（バックエンドプロキシ + HttpOnly Cookie）

### ⑥ バージョン更新 ✅ 完了

- `Settings.tsx`: v0.5.0 → v0.5.1（「AI社長室 v0.5.1 Phase 5.1」）
- `README.md`: v0.5.0 → v0.5.1

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
# Phase 6.1 より VITE_GMAIL_CLIENT_ID → VITE_GOOGLE_CLIENT_ID に統一（Gmail/Calendar/Drive共通）
VITE_GOOGLE_CLIENT_ID=
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
VITE_GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly
```

### ⑪ README ✅ 完了

Phase 5 セクション追加（OAuth構造・フロー図・書き込みなし証拠表）。

---

## 未実装項目（意図的に保留）

| 項目 | 保留理由 |
|------|---------|
| 本番 Gmail / Calendar API への実接続 | `VITE_GOOGLE_CLIENT_ID` が未設定。設定後は即時動作。 |
| バックエンド Proxy 経由のトークン交換 | SPA で直接トークン交換するため client_secret がフロントに露出する点の改善（Phase 6 以降） |
| アクセストークンの自動リフレッシュ UI 表示 | 内部では `googleToken.refresh()` が実装済み。画面表示は未追加。 |
| XSS 対策の完全実装 | CSP 設定・DOMPurify は本番化前に実施予定 |
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
