# FILES_CHANGED.md — 変更・追加・削除ファイル一覧

> 最終更新: Phase 6 — v0.6.0（2026-06-27）

---

## Phase 6 変更ファイル

### 新規作成 (8ファイル)

| ファイルパス | 役割 |
|-------------|------|
| `client/src/services/calendar/types.ts` | Calendar API 型 / CalendarDerivedEvent / CalendarSummary |
| `client/src/services/calendar/mockCalendar.ts` | デモ予定データ（銀行・現場・行政等 5件） |
| `client/src/services/calendar/calendarClient.ts` | Calendar ReadOnly 入口（mock/cache/api 切り替え） |
| `client/src/services/calendar/calendarFetcher.ts` | GET 専用フェッチャー（書き込みAPI未実装） |
| `client/src/services/calendar/calendarMapper.ts` | GoogleCalendarEvent → UnifiedScheduleItem 変換 |
| `client/src/services/calendar/calendarAnalyzer.ts` | 重要度・カテゴリ・期限リスク・推奨アクション判定 |
| `client/src/services/calendar/calendarCache.ts` | ローカルキャッシュ（5分 TTL） |
| `docs/release-check/CALENDAR_READONLY_DESIGN.md` | Calendar ReadOnly 設計書（新規） |

### 更新 (13ファイル)

| ファイルパス | 変更内容 |
|-------------|---------|
| `client/src/services/google/googleScopes.ts` | CALENDAR_READONLY 昇格・PHASE6_SCOPES 追加・FORBIDDEN_SCOPES 定義 |
| `client/src/core/providers/providerTypes.ts` | UnifiedScheduleItem 拡張（11フィールド追加） |
| `client/src/core/providers/scheduleProvider.ts` | stub → Google Calendar 接続実装 |
| `client/src/core/ai-engine/priorityEngine.ts` | Inbox × Schedule 横断スコアリング追加 |
| `client/src/core/ai-engine/briefingEngine.ts` | Schedule セクション追加・横断アクション生成 |
| `client/src/components/screens/CockpitScreen.tsx` | 今日の予定セクション追加（Schedule Provider 由来） |
| `client/src/components/screens/Home.tsx` | 今日の予定カード追加（Schedule Provider 由来） |
| `client/src/components/screens/AiChat.tsx` | カレンダーショートカット追加・回答ロジック追加 |
| `client/src/components/screens/Settings.tsx` | Phase 6 表記更新・v0.6.0 バージョン更新 |
| `README.md` | Phase 6 セクション追加 |
| `docs/release-check/CHANGELOG_PHASE.md` | Phase 6 変更履歴追加 |
| `docs/release-check/FILES_CHANGED.md` | Phase 6 ファイル一覧追加（本ファイル） |
| `docs/release-check/IMPLEMENTATION_REPORT.md` | Phase 6 実装内容追加 |
| `docs/release-check/SAFETY_REPORT.md` | Phase 6 Calendar 安全確認追加 |
| `docs/release-check/TEST_CHECKLIST.md` | Phase 6 テスト項目追加 |
| `docs/release-check/DATA_FLOW.md` | Calendar データフロー追加 |
| `docs/release-check/ARCHITECTURE_OVERVIEW.md` | Schedule Provider 接続状態更新 |
| `docs/release-check/PROVIDER_DESIGN.md` | scheduleProvider 実装詳細追加 |
| `docs/release-check/AI_ENGINE_DESIGN.md` | Schedule 横断ロジック更新 |
| `docs/release-check/NO_SCREENSHOT_REQUIRED.md` | CALENDAR_READONLY_DESIGN.md 追加 |

### 削除 (0ファイル)

なし

---

## Phase 5.5 変更ファイル

### 新規作成 (20ファイル)

| ファイルパス | 役割 |
|-------------|------|
| `client/src/core/providers/providerTypes.ts` | Provider統一型・Unified型定義 |
| `client/src/core/providers/inboxProvider.ts` | Gmail → UnifiedInboxItem（接続済み） |
| `client/src/core/providers/scheduleProvider.ts` | Calendar stub（Phase 6予定） |
| `client/src/core/providers/fileProvider.ts` | Drive stub（将来） |
| `client/src/core/providers/businessDataProvider.ts` | Sheets/freee/TKC stub（将来） |
| `client/src/core/providers/workflowProvider.ts` | 承認フロー stub（将来） |
| `client/src/core/providers/notificationProvider.ts` | 朝ブリーフィング stub（将来） |
| `client/src/core/providers/providerRegistry.ts` | 全Provider一覧・アクセス窓口 |
| `client/src/core/providers/providerHealth.ts` | Provider健全性チェック |
| `client/src/core/ai-engine/aiEngineTypes.ts` | AI Engine共通型 |
| `client/src/core/ai-engine/normalizer.ts` | サービスデータ → Unified型変換 |
| `client/src/core/ai-engine/priorityEngine.ts` | 横断優先度スコアリング |
| `client/src/core/ai-engine/briefingEngine.ts` | 朝ブリーフィング生成 |
| `client/src/core/ai-engine/riskEngine.ts` | 横断リスク検知 |
| `client/src/core/ai-engine/actionEngine.ts` | 推奨アクション生成（提案のみ） |
| `client/src/core/ai-engine/searchEngine.ts` | 横断検索stub |
| `client/src/core/ai-engine/approvalEngine.ts` | 社長承認ゲート |
| `docs/release-check/ARCHITECTURE_OVERVIEW.md` | アーキテクチャ概要（新規） |
| `docs/release-check/PROVIDER_DESIGN.md` | Provider設計書（新規） |
| `docs/release-check/AI_ENGINE_DESIGN.md` | AI Engine設計書（新規） |

### 更新 (10ファイル)

| ファイルパス | 変更内容 |
|-------------|---------|
| `client/src/components/screens/Settings.tsx` | AI社長室データ基盤カード追加、Provider一覧表示 |
| `client/src/components/screens/CockpitScreen.tsx` | AI Engine コメント追加（将来切り替えポイント） |
| `README.md` | Phase 5.5 セクション追加 |
| `docs/release-check/CHANGELOG_PHASE.md` | Phase 5.5 変更履歴追加 |
| `docs/release-check/FILES_CHANGED.md` | Phase 5.5 ファイル一覧追加（本ファイル） |
| `docs/release-check/IMPLEMENTATION_REPORT.md` | Phase 5.5 実装内容追加 |
| `docs/release-check/SAFETY_REPORT.md` | Phase 5.5 安全確認追加 |
| `docs/release-check/TEST_CHECKLIST.md` | Phase 5.5 テスト項目追加 |
| `docs/release-check/NO_SCREENSHOT_REQUIRED.md` | 3新規ドキュメント追加 |
| `docs/release-check/DATA_FLOW.md` | Provider/AI Engine データフロー追加 |

### 削除 (0ファイル)

なし

---

## Phase 5.1 変更ファイル

### 新規作成 (3ファイル)

| ファイルパス | 役割 |
|-------------|------|
| `client/src/services/google/googleConfig.ts` | OAuth接続前チェック関数（Client ID/Redirect URI/スコープ検証） |
| `docs/release-check/OAUTH_SECURITY_REVIEW.md` | OAuth安全設計レビュー（スコープ・書き込みなし・SPA リスク） |
| `docs/release-check/GOOGLE_CONNECT_CHECKLIST.md` | Google Cloud Console 設定チェックリスト（Step 1〜8） |

### 更新 (11ファイル)

| ファイルパス | 変更内容 |
|-------------|---------|
| `client/src/components/screens/Settings.tsx` | 接続前チェック UI 追加、v0.5.1 バージョン更新 |
| `README.md` | Phase 5.1 セクション・SPA OAuth リスク追加、バージョン更新 |
| `docs/release-check/CHANGELOG_PHASE.md` | Phase 5.1 変更履歴追加 |
| `docs/release-check/FILES_CHANGED.md` | Phase 5.1 ファイル一覧追加（本ファイル） |
| `docs/release-check/IMPLEMENTATION_REPORT.md` | Phase 5.1 実装内容追加 |
| `docs/release-check/SAFETY_REPORT.md` | Phase 5.1 安全確認追加 |
| `docs/release-check/SCREEN_LIST.md` | Phase 5.1 画面追加（接続前チェックパネル） |
| `docs/release-check/TEST_CHECKLIST.md` | Phase 5.1 テスト項目追加 |
| `docs/release-check/ROUTE_MAP.md` | Phase 5.1 更新日時更新 |
| `docs/release-check/DATA_FLOW.md` | Phase 5.1 更新日時更新 |
| `docs/release-check/NO_SCREENSHOT_REQUIRED.md` | Phase 5.1 更新日時更新 |

### 削除 (0ファイル)

なし

---

## Phase 5 変更ファイル

### 新規作成 (11ファイル)

| ファイルパス | 役割 |
|-------------|------|
| `client/src/services/google/googleScopes.ts` | OAuth スコープ定数（gmail.readonly のみ） |
| `client/src/services/google/googleErrors.ts` | GoogleAuthError クラスと8種エラーコード |
| `client/src/services/google/googleStorage.ts` | localStorage/sessionStorage ラッパー |
| `client/src/services/google/googleToken.ts` | トークン管理・有効性チェック・自動リフレッシュ |
| `client/src/services/google/googleAuth.ts` | OAuth PKCE フロー実装（認証URL・コールバック・切断） |
| `client/src/services/google/googleSession.ts` | セッション状態管理 |
| `client/src/services/gmail/gmailFetcher.ts` | Gmail API 読み取り専用フェッチャー（GET のみ） |
| `client/src/services/gmail/gmailCache.ts` | ローカルキャッシュ（5分 TTL） |
| `client/src/services/gmail/briefingGenerator.ts` | メールデータからブリーフィング生成構造 |
| `client/src/vite-env.d.ts` | Vite 環境変数の TypeScript 型定義 |
| `client/.env.example` | Google OAuth 環境変数テンプレート |

### 更新 (6ファイル)

| ファイルパス | 変更内容 |
|-------------|---------|
| `client/src/App.tsx` | OAuth コールバック処理追加（useEffect on mount） |
| `client/src/components/screens/Settings.tsx` | Google接続カード追加、v0.5.0 バージョン更新 |
| `client/src/services/gmail/gmailClient.ts` | 認証済み時に本番 API 呼び出しするよう更新 |
| `.env.example` | ルートに VITE_GMAIL_CLIENT_ID 等の変数追記 |
| `README.md` | Phase 5 セクション追加、ロードマップ更新 |
| `public/index.html` | Vite ビルド成果物更新 |

### 削除 (0ファイル)

なし

---

## フェーズ別ファイル累積一覧

### client/src/services/gmail/ (Phase 4〜5)

| ファイル | 追加フェーズ |
|---------|-----------|
| `types.ts` | Phase 4 |
| `mockGmail.ts` | Phase 4 |
| `gmailAnalyzer.ts` | Phase 4 (Phase 4.1更新) |
| `gmailMapper.ts` | Phase 4 |
| `gmailClient.ts` | Phase 4 (Phase 5更新) |
| `gmailCache.ts` | Phase 5 |
| `gmailFetcher.ts` | Phase 5 |
| `briefingGenerator.ts` | Phase 5 |

### client/src/services/google/ (Phase 5)

| ファイル | 追加フェーズ |
|---------|-----------|
| `googleScopes.ts` | Phase 5 |
| `googleErrors.ts` | Phase 5 |
| `googleStorage.ts` | Phase 5 |
| `googleToken.ts` | Phase 5 |
| `googleAuth.ts` | Phase 5 |
| `googleSession.ts` | Phase 5 |

### client/src/components/screens/ (Phase 1〜5)

| ファイル | 最終更新フェーズ |
|---------|---------------|
| `Home.tsx` | Phase 4.1 |
| `AiChat.tsx` | Phase 4 |
| `TodayActions.tsx` | Phase 4.1 |
| `CreateRequest.tsx` | Phase 1 |
| `Dashboard.tsx` | Phase 2 |
| `Settings.tsx` | Phase 5.1 |
| `CockpitScreen.tsx` | Phase 4.1 |

### client/src/components/ (Phase 1〜3.5)

| ファイル | 追加フェーズ |
|---------|-----------|
| `Navigation.tsx` | Phase 3.5 |
| `DemoBanner.tsx` | Phase 3.5 |
| `VoiceModal.tsx` | Phase 2 |

### ルート

| ファイル | 最終更新フェーズ |
|---------|---------------|
| `client/src/App.tsx` | Phase 5 |
| `client/src/data/mockData.ts` | Phase 4.1 |
| `client/src/types/index.ts` | Phase 1 |
| `client/.env.example` | Phase 5 |
| `.env.example` | Phase 5 |
| `README.md` | Phase 5.1 |
