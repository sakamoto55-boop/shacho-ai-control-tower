# CHANGELOG_PHASE.md — フェーズ別変更履歴

> このファイルは各フェーズ完了時に更新します。

---

## Phase 6.1 — v0.6.1（2026-06-27）

### 変更テーマ
Google OAuth 環境変数名を Gmail 専用から共通化（Gmail / Calendar / Drive / Sheets 共通 Client ID に統一）。

### 変更内容

- `VITE_GMAIL_CLIENT_ID` → **`VITE_GOOGLE_CLIENT_ID`**（Gmail/Calendar/Drive共通）
- `VITE_GOOGLE_READONLY_SCOPE` → **`VITE_GOOGLE_SCOPES`**（複数スコープ対応）
- `VITE_GMAIL_CLIENT_SECRET` 廃止（SPA では使用しない方針を明文化）
- 修正ファイル: `googleConfig.ts` / `googleAuth.ts` / `googleToken.ts` / `googleErrors.ts` / `client/.env.example` / `.env.example` / `README.md` / docs 7ファイル

---

## Phase 6 — v0.6.0（2026-06-27）

### 変更テーマ
Google Calendar ReadOnly を Schedule Provider として接続。Inbox Provider との横断分析開始。

### 追加した機能

**Calendar サービス層（7ファイル）**
- `client/src/services/calendar/types.ts`: GoogleCalendarEvent / CalendarDerivedEvent / CalendarSummary 型定義
- `client/src/services/calendar/mockCalendar.ts`: デモ予定データ（銀行・現場・行政・運営確認等 5件）
- `client/src/services/calendar/calendarClient.ts`: Calendar ReadOnly 入口（認証なし→mock、認証済み→API）
- `client/src/services/calendar/calendarFetcher.ts`: GET 専用フェッチャー（書き込みAPI未実装）
- `client/src/services/calendar/calendarMapper.ts`: GoogleCalendarEvent → CalendarDerivedEvent → UnifiedScheduleItem 変換
- `client/src/services/calendar/calendarAnalyzer.ts`: 重要度・カテゴリ・期限リスク・推奨アクション・CalendarSummary 判定
- `client/src/services/calendar/calendarCache.ts`: ローカルキャッシュ（5分 TTL）

**docs（新規）**
- `docs/release-check/CALENDAR_READONLY_DESIGN.md`: Calendar ReadOnly 設計書

### 変更した機能

- `googleScopes.ts`: CALENDAR_READONLY をアクティブスコープへ昇格（FUTURE_SCOPES → GOOGLE_SCOPES）。PHASE6_SCOPES 追加。FORBIDDEN_SCOPES 定義。`hasWriteScope()` 関数追加。
- `providerTypes.ts`: `UnifiedScheduleItem` を拡張（description / attendees / calendarName / category / relatedCompany / relatedPerson / deadlineRisk / suggestedAction / readOnly: true / writeEnabled: false）
- `scheduleProvider.ts`: stub → Google Calendar 接続実装（認証なし→デモ）
- `priorityEngine.ts`: Inbox × Schedule 横断スコアリング追加（同日同カテゴリ +20、関連予定最重要 +10、scheduleItem スコアリング追加）
- `briefingEngine.ts`: Schedule Provider を含むセクション追加、Inbox × Schedule 横断アクション生成
- `CockpitScreen.tsx`: 今日の予定セクション追加（重要/移動/期限/銀行カウント + 予定リスト）
- `Home.tsx`: 今日の予定カード追加（Schedule Provider 由来）
- `AiChat.tsx`: カレンダーショートカット追加（5種）、カレンダー回答ロジック追加
- `Settings.tsx`: AI社長室データ基盤カードを Phase 6 表記へ更新、v0.6.0 バージョン更新
- `docs/release-check/` 11ファイル: Phase 6 内容に更新

### 削除した機能
- なし

### 外部サービス追加
- Google Calendar ReadOnly（`calendar.readonly` スコープのみ。書き込みなし。）

---

## Phase 5.5 — v0.5.5（2026-06-27）

### 変更テーマ
Provider設計 + AI Engine基盤構築（外部API接続なし・書き込みなし・アーキテクチャリファクタリング）

### 追加した機能
- `client/src/core/providers/providerTypes.ts`: 統一型定義（ProviderDescriptor / UnifiedInboxItem / UnifiedRisk 等 9型）
- `client/src/core/providers/inboxProvider.ts`: Gmail → UnifiedInboxItem 変換（既存gmailサービス活用）
- `client/src/core/providers/scheduleProvider.ts`: Calendar stub（Phase 6予定）
- `client/src/core/providers/fileProvider.ts`: Drive stub（将来）
- `client/src/core/providers/businessDataProvider.ts`: Sheets/freee/TKC stub（将来）
- `client/src/core/providers/workflowProvider.ts`: 承認フロー stub（将来）
- `client/src/core/providers/notificationProvider.ts`: 朝ブリーフィング stub（将来）
- `client/src/core/providers/providerRegistry.ts`: 全Provider一覧・アクセス窓口
- `client/src/core/providers/providerHealth.ts`: Provider健全性チェック
- `client/src/core/ai-engine/aiEngineTypes.ts`: AI Engine共通型定義
- `client/src/core/ai-engine/normalizer.ts`: サービスデータ → Unified型変換
- `client/src/core/ai-engine/priorityEngine.ts`: 横断優先度スコアリング
- `client/src/core/ai-engine/briefingEngine.ts`: 朝ブリーフィング生成
- `client/src/core/ai-engine/riskEngine.ts`: 横断リスク検知
- `client/src/core/ai-engine/actionEngine.ts`: 推奨アクション生成（提案のみ）
- `client/src/core/ai-engine/searchEngine.ts`: 横断検索stub
- `client/src/core/ai-engine/approvalEngine.ts`: 社長承認ゲート
- `docs/release-check/ARCHITECTURE_OVERVIEW.md`: アーキテクチャ概要（新規）
- `docs/release-check/PROVIDER_DESIGN.md`: Provider設計書（新規）
- `docs/release-check/AI_ENGINE_DESIGN.md`: AI Engine設計書（新規）

### 変更した機能
- `client/src/components/screens/Settings.tsx`: AI社長室データ基盤カード追加（Provider一覧・健全性）
- `client/src/components/screens/CockpitScreen.tsx`: AI Engine コメント追加（将来切り替えポイント明示）
- `README.md`: Phase 5.5 セクション追加
- `docs/release-check/` 8ファイル: Phase 5.5 内容に更新

### 削除した機能
- なし

### 外部サービス追加
- なし（アーキテクチャ設計のみ · 外部接続ゼロ）

---

## Phase 5.1 — v0.5.1（2026-06-27）

### 変更テーマ
OAuth 安全性強化・接続前チェック UI・Google Cloud Console 設定手順書

### 追加した機能
- `googleConfig.ts`: OAuth 接続前チェック関数 `getOAuthPreConnectCheck()`
- 設定画面（未接続時）に「🔍 接続前チェック」パネル追加
  - Client ID設定 / Redirect URI設定 / スコープ / 書き込みAPI / 本番接続準備 を表示
- `OAUTH_SECURITY_REVIEW.md`: スコープ検証・書き込みAPI不在・トークン保存・SPA リスク・本番化前注意事項
- `GOOGLE_CONNECT_CHECKLIST.md`: Google Cloud Console の Step-by-Step 設定チェックリスト
- README に「SPA OAuth セキュリティリスクと対応方針」セクション追加
- README 検収ドキュメント表に 2 ファイル追加

### 変更した機能
- `Settings.tsx`: 接続前チェック UI 追加、バージョン v0.5.0 → v0.5.1
- `README.md`: バージョン更新、Phase 5.1 セクション・SPA OAuth リスク追加
- `docs/release-check/` 全 9 ファイル: Phase 5.1 内容に更新

### 削除した機能
- なし

### 外部サービス追加
- なし（既存構造の強化のみ）

---

## Phase 5 — v0.5.0（2026-06-27）

### 変更テーマ
Google OAuth 認証基盤の構築（Authorization Code + PKCE）  
Gmail ReadOnly スコープのみ。書き込み処理はゼロ。

### 追加した機能
- Google OAuth PKCE フロー（認証URL生成・コールバック処理・state検証）
- アクセストークン保存・有効性チェック・自動リフレッシュ
- セッション状態管理（未接続 / 接続中 / 接続済み / エラー）
- OAuth 認証ログ（最大50件 localStorage 保存）
- Gmail API 読み取り専用フェッチャー（`GET` のみ）
- ローカルキャッシュ（5分 TTL）
- メールデータからブリーフィング生成する構造（`briefingGenerator.ts`）
- 設定画面に Google 接続カード（接続・切断・ログ表示）
- App.tsx で OAuth コールバック自動処理
- `client/.env.example`（`VITE_GOOGLE_CLIENT_ID` 等 ← Phase 6.1 で変数名統一）

### 変更した機能
- `gmailClient.ts`: 認証済みなら本番 Gmail API、未認証なら mockGmail を使用
- `Settings.tsx`: バージョン v0.4.1 → v0.5.0、Google接続カード追加
- `README.md`: Phase 5 セクション追加、ロードマップ更新

### 削除した機能
- なし

---

## Phase 4.1 — v0.4.1（2026-06-27）

### 変更テーマ
Gmail由来データの全画面表示強化

### 追加した機能
- `createGmailSummary()` 関数（件数集計）
- `GmailSummary` インターフェース
- ホーム画面: Gmail要対応サマリーカード
- AIコックピット: Gmailセクション件数内訳 + TOP3詳細
- 今日の要対応: デモGmailバッジ・返信未送信バッジ・モーダル強化
- 設定: 常時表示 Gmail読み取りテストカード

### 変更した機能
- AI相談: Gmailショートカット回答を mockGmail 実データ基準に強化
- Home.tsx: 未使用 import 除去（ビルドエラー修正）

---

## Phase 4 — v0.4.0（2026-06-27）

### 変更テーマ
Gmail 読み取り専用サービス層の構築

### 追加した機能
- `client/src/services/gmail/` ディレクトリ（5ファイル）
- mockGmail 5件（銀行/工事代金/監督署/契約/外注費）
- 今日の要対応: Gmail由来セクション・詳細モーダル
- AIコックピット: Gmail由来リスト
- AI相談: Gmail ショートカット5件
- 設定: 本番準備モード ON 時の Gmail 連携カード

---

## Phase 3.5 — v0.3.5（2026-06-27）

### 変更テーマ
品質調整・ナビ再編・デモモード設定

### 主な変更
- ナビ: [ホーム/コックピット/AI相談/要対応/経営]（作成をナビから除外）
- DemoBanner 全主要画面に追加
- 設定: デモモード / 本番準備モード インタラクティブトグル化
- 法人名修正: みらい介護サポート → 一般社団法人みらい創造公社

---

## Phase 3 — v0.3.0（2026-06-27）

### 変更テーマ
AIコックピット追加

### 主な変更
- AIコックピット画面（会社健康スコア・優先順位TOP5・時系列ビュー・AI検索）
- ナビに「🎯コックピット」タブ追加

---

## Phase 2 — v0.2.0（2026-06-27）

### 変更テーマ
モバイルUI全面強化

### 主な変更
- AIブリーフィングカード・状況カード8枚
- AI相談 6モード（秘書/経営/現場/事務/営業/福祉）
- 今日の要対応 詳細モーダル
- 経営ダッシュボード 13週資金繰りグラフ
- 音声入力モーダル

---

## Phase 1 — v0.1.0（2026-06-27）

### 変更テーマ
iPhone最優先スマホMVP初版

### 主な変更
- React 18 + TypeScript + Vite SPA 初期構築
- 下部ナビゲーション
- ホーム・AI相談・要対応・作成・経営・設定 6画面
- 仮データ（mockData.ts）
