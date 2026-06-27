# 社長AI管制塔 Phase 1

会社メール、LINE WORKS、手入力された外部連絡をAI分析し、要約、タスク抽出、返信下書き、リスク判定、朝昼晩レポートを作るローカルMVPです。

---

## AI社長室 スマホMVP（フロントエンド）

`client/` ディレクトリに、**iPhone最優先のスマホ対応Webアプリ**が含まれています。

> **現在のバージョン：v0.5.1 Phase 5.1**
> すべての数値・メッセージは仮データです。Gmail読み取り専用連携の構造を追加しましたが、実際の認証情報は未設定のため mockGmail を使用しています。Gmailへの書き込み（送信・返信・削除・ラベル変更等）は未実装です。

### 検収ドキュメント

| ファイル | 内容 |
|---------|------|
| [CHANGELOG_PHASE.md](docs/release-check/CHANGELOG_PHASE.md) | フェーズ別変更履歴 |
| [FILES_CHANGED.md](docs/release-check/FILES_CHANGED.md) | 変更・追加・削除ファイル一覧 |
| [IMPLEMENTATION_REPORT.md](docs/release-check/IMPLEMENTATION_REPORT.md) | 実装内容・未実装項目・注意点 |
| [SAFETY_REPORT.md](docs/release-check/SAFETY_REPORT.md) | 外部API接続状況・書き込み禁止確認 |
| [SCREEN_LIST.md](docs/release-check/SCREEN_LIST.md) | 変更画面・確認すべき画面・想定表示 |
| [TEST_CHECKLIST.md](docs/release-check/TEST_CHECKLIST.md) | 手動検収チェックリスト |
| [ROUTE_MAP.md](docs/release-check/ROUTE_MAP.md) | 画面遷移と主要導線 |
| [DATA_FLOW.md](docs/release-check/DATA_FLOW.md) | データの流れ |
| [NO_SCREENSHOT_REQUIRED.md](docs/release-check/NO_SCREENSHOT_REQUIRED.md) | スクリーンショット不要の検収フロー |
| [OAUTH_SECURITY_REVIEW.md](docs/release-check/OAUTH_SECURITY_REVIEW.md) | OAuth安全設計レビュー（Phase 5.1追加） |
| [GOOGLE_CONNECT_CHECKLIST.md](docs/release-check/GOOGLE_CONNECT_CHECKLIST.md) | Google Cloud Console 設定チェックリスト（Phase 5.1追加） |

---

### 画面一覧

| 画面 | 説明 |
|------|------|
| ホーム | AIブリーフィングカード・今日の状況8枚・クイックアクション・業務ポータル |
| **AIコックピット** ★新規 | 会社健康スコア・優先順位TOP5・ワンタップ実行・時系列ビュー・AI会社検索 |
| 今日の要対応 | 優先度A/B・確認待ち・作成待ちをカード形式で管理、詳細モーダル付き |
| 作成依頼 | 目的・相手・背景・内容・トーン・出力形式を指定してAI生成（仮） |
| 経営ダッシュボード | 月次売上・粗利・13週資金繰りグラフ・案件粗利ランキング・部署別利益 |
| 設定 | データ連携ステータス・会社選択・権限区分・接続予定ロードマップ |

### フロントエンドのセットアップ・起動

```bash
cd client
npm install
npm run dev      # http://localhost:5173
npm run build    # ../public/ に本番ビルド出力
```

### 主要コンポーネント

```
client/src/
├── components/
│   ├── Navigation.tsx       # 下部固定ナビゲーション（5タブ）
│   ├── VoiceModal.tsx       # 音声入力モーダル（接続準備中）
│   └── screens/
│       ├── Home.tsx         # ホーム（AIブリーフィング + 状況カード）
│       ├── AiChat.tsx       # AI相談チャット（6モードタブ）
│       ├── TodayActions.tsx # 今日の要対応（詳細モーダル付き）
│       ├── CreateRequest.tsx # 作成依頼（目的→フォーム→生成結果）
│       ├── Dashboard.tsx    # 経営ダッシュボード（13週資金繰りグラフ）
│       └── Settings.tsx     # 設定・接続ロードマップ
├── data/
│   └── mockData.ts          # 仮データ（API連携まで使用）
└── types/
    └── index.ts             # 型定義
```

---

## Phase 5 で追加した内容（Google OAuth 認証基盤）

### 概要

Phase 5 では「実データ連携基盤」を構築しました。  
**Google OAuth Authorization Code + PKCE フロー**により、Googleアカウントへ安全に接続できる構造を実装しています。  
**取得スコープは `gmail.readonly` のみ。書き込み系 API は一切実装していません。**

---

### OAuth 取得フロー図

```
ユーザー（設定画面）
     │
     ▼「Googleアカウントで接続」ボタン
googleAuth.startOAuthFlow()
     │ PKCE: code_verifier生成 → SHA256 → code_challenge
     │ state生成（CSRF対策）
     │ sessionStorageに保存
     ▼
Google 認証画面（accounts.google.com）
     │ ユーザーが Gmail ReadOnly を承認
     ▼
アプリへリダイレクト（?code=...&state=...）
     │
     ▼ App.tsx useEffect が検知
googleAuth.handleCallback(code, state)
     │ state 検証（CSRF対策）
     │ PKCE code_verifier を取り出し
     │ https://oauth2.googleapis.com/token へ POST
     │ → access_token, refresh_token, scope を取得
     │ → https://www.googleapis.com/oauth2/v3/userinfo でメールアドレス確認
     │ localStorage にトークン保存
     ▼
設定画面へ遷移 → 「✓ 接続済み」表示
     │
     ▼ Gmail取得時（AIコックピット等）
fetchRawMessages()
     │ googleToken.isValid() → キャッシュ確認（5分TTL）
     │ キャッシュ有効 → キャッシュを返す（API呼び出しなし）
     │ キャッシュ無効 → gmailFetcher.fetchMessages(accessToken)
     │   ① GET /gmail/v1/users/me/messages?q=is:unread newer_than:3d
     │   ② GET /gmail/v1/users/me/messages/{id}?format=full（並列最大10件）
     │   → GmailMessage[] に変換
     │ → gmailCache.set() でローカル保存
     ▼
gmailAnalyzer.ts で種別・優先度・期限を判定
     ▼
AIコックピット・今日の要対応・ホームに表示
```

---

### Google サービス層（新規追加）

```
client/src/services/google/
├── googleScopes.ts    — スコープ定数（Phase 5: gmail.readonly のみ）
├── googleErrors.ts    — GoogleAuthError クラスとエラーコード定義
├── googleStorage.ts   — localStorage/sessionStorage ラッパー（トークン・PKCE・キャッシュ・ログ）
├── googleToken.ts     — トークン有効性確認・保存・リフレッシュ
├── googleAuth.ts      — OAuth フロー実装（PKCE生成・認証URL生成・コールバック処理）
└── googleSession.ts   — セッション状態管理（接続済み/接続中/エラー/未接続）
```

### Gmail サービス層（強化）

```
client/src/services/gmail/
├── gmailFetcher.ts       — 新規: Gmail API 読み取り専用フェッチャー
├── gmailCache.ts         — 新規: ローカルキャッシュ（5分TTL）
├── briefingGenerator.ts  — 新規: メールデータからAIブリーフィングを生成する構造
└── gmailClient.ts        — 更新: 認証済みなら本番API、未認証なら mockGmail を使用
```

### .env 設定

`client/.env.example` を参照してください。

```env
VITE_GMAIL_CLIENT_ID=（Google Cloud Console で取得）
VITE_GMAIL_CLIENT_SECRET=（取得後に設定）
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
VITE_GOOGLE_READONLY_SCOPE=https://www.googleapis.com/auth/gmail.readonly
```

### ログ記録

以下のイベントを localStorage に最大50件記録します：

| イベント | タイミング |
|---------|-----------|
| `oauth_start` | OAuth認証フロー開始時 |
| `oauth_success` | トークン取得・保存成功時（メールアドレス含む） |
| `oauth_error` | 認証失敗・state不一致・トークン取得失敗時 |
| `token_refresh` | アクセストークンのリフレッシュ時 |
| `fetch_start` | Gmail API 取得開始時（query・件数） |
| `fetch_success` | Gmail API 取得成功時（件数・所要時間） |
| `fetch_error` | Gmail API 取得失敗時（エラー内容） |
| `disconnect` | Googleアカウント切断時 |

設定画面の「認証ログを見る」で確認できます。

### キャッシュ設計

- キャッシュ有効期限: **5分**
- 保存先: **localStorage**（gmailCache.ts）
- `gmailCache.isStale()` が true の場合のみ Google API を呼ぶ
- 手動リフレッシュ: `refreshMessages()` でキャッシュクリア後に再取得

### 書き込みAPIを実装していない証拠

`client/src/services/` 配下に以下の関数・エンドポイントは**存在しない**：

| 禁止処理 | 関数名 | 状態 |
|---------|--------|------|
| メール送信 | `sendMessage` | 未実装 |
| メール返信 | `replyMessage` | 未実装 |
| 下書き作成 | `createDraft` | 未実装 |
| メール削除 | `deleteMessage` | 未実装 |
| アーカイブ | `archiveMessage` | 未実装 |
| 既読化 | `markAsRead` | 未実装 |
| スター付与 | `addStar` | 未実装 |
| ラベル変更 | `modifyLabels` | 未実装 |

`gmailFetcher.ts` は `GET` リクエストのみ。`POST`/`PATCH`/`DELETE` は一切存在しない。

### 安全設計

- OAuth スコープ: `gmail.readonly` のみ（`gmail.modify` / `gmail.send` / `gmail.compose` は取得しない）
- PKCE: code_verifier を sessionStorage に保存、トークン交換後に削除
- state パラメータ: CSRF 対策として検証
- トークン: localStorage に保存（HttpOnly Cookie は SPA では使用不可）
- リフレッシュトークン: `google.accounts.oauth2` を通じて取得
- 本番運用推奨: バックエンド Proxy 経由でのトークン交換（Phase 6 以降で対応予定）

---

## Phase 5.1 で追加した内容（OAuth安全性強化・接続前チェックUI）

### 概要

Phase 5.1 では、Phase 5 で構築した OAuth 基盤に対して**安全性レビューと接続前検証 UI** を追加しました。  
新しい外部サービス連携は追加していません。

### 追加したもの

| 追加内容 | ファイル |
|---------|--------|
| OAuth接続前チェック機能 | `client/src/services/google/googleConfig.ts` |
| 接続前チェックUI（設定画面） | `client/src/components/screens/Settings.tsx` |
| OAuth安全設計レビュー | `docs/release-check/OAUTH_SECURITY_REVIEW.md` |
| Google Cloud Console設定手順 | `docs/release-check/GOOGLE_CONNECT_CHECKLIST.md` |

### 接続前チェック UI

設定画面の Google 接続カード（未接続状態時）に「🔍 接続前チェック」パネルを追加しました。

| チェック項目 | 内容 |
|------------|------|
| Client ID設定 | `VITE_GMAIL_CLIENT_ID` の設定有無（設定済みは末尾のみ表示） |
| Redirect URI設定 | `VITE_GOOGLE_REDIRECT_URI` の設定有無と現在値 |
| スコープ | `gmail.readonly` のみであることを表示 |
| 書き込みAPI | 未実装であることを表示 |
| 本番接続準備 | Client ID と Redirect URI が両方設定済みなら「完了」 |

### SPA における OAuth セキュリティリスクと対応方針

#### 現行 SPA フローの制約

```
⚠️ SPA（ブラウザのみ）での OAuth には以下の制約があります：

1. client_secret をフロントエンドに含められない
   → VITE_GMAIL_CLIENT_SECRET は設定禁止（ビルド後に公開される）
   → Google Cloud Console で「ウェブ アプリケーション」タイプを選択し、
     SPA として登録することで client_secret なしで動作します

2. アクセストークン・リフレッシュトークンが localStorage に存在する
   → XSS 攻撃を受けた場合にトークンが窃取されるリスクがある

3. VITE_ 変数はビルド時にバンドルに含まれる
   → VITE_GMAIL_CLIENT_ID は公開リポジトリの .env にコミット禁止
```

#### 絶対に行ってはいけないこと

```
❌ .env ファイルを Git にコミットしない（.gitignore に含まれています）
❌ VITE_GMAIL_CLIENT_SECRET をコードや .env.example 以外に記載しない
❌ VITE_GMAIL_CLIENT_ID を README やコードコメントに直書きしない
❌ client_secret をフロントエンドコードに埋め込まない
```

#### 本番化前に推奨するアーキテクチャ変更

```
[現行] SPA がトークンを localStorage に直接保管
  ブラウザ → Google OAuth → ブラウザ（localStorage にトークン保管）

[本番推奨] バックエンドプロキシ経由でトークン管理
  ブラウザ → バックエンド → Google OAuth → バックエンド
                                                 ↓
                                     HttpOnly Cookie でセッション管理
                                     （ブラウザ JS からアクセス不可）
```

詳細は [OAUTH_SECURITY_REVIEW.md](docs/release-check/OAUTH_SECURITY_REVIEW.md) を参照してください。

---

### Phase 6 予定

**Phase 6**: Googleカレンダー読み取り専用連携  
スコープ: `calendar.readonly`（現時点では取得しない）

---

## Phase 4.1 で追加した内容（Gmail由来データの画面表示強化）

### 変更概要

Phase 4.1では、Phase 4で追加したGmailサービス層を活かし、**全主要画面でGmail由来データが一目でわかる**ように表示を強化しました。

### mockGmailのみを使用

Phase 4.1においても、`mockGmail.ts` 内の仮データのみを使用しています。  
外部Gmail APIには接続していません。本番認証情報は一切使用しません。

### Gmail書き込み禁止の継続

以下はすべて未実装のままです（Phase 4.1でも変更なし）：
- 送信・返信
- 下書き作成
- 削除・アーカイブ
- 既読化・未読化
- ラベル変更・スター付与

### 追加した関数：`createGmailSummary()`

`gmailAnalyzer.ts` に `createGmailSummary()` 関数を追加しました。  
mockGmailメッセージから以下の集計値を生成します：

| フィールド | 内容 |
|-----------|------|
| `totalCount` | メール総数 |
| `priorityACount` | 優先度A（重要）件数 |
| `todayDueCount` | 本日中対応が必要な件数 |
| `bankCount` | 銀行関連メール件数 |
| `billingCount` | 請求・支払関連件数 |
| `contractCount` | 契約関連件数 |
| `replyDraftCount` | 返信たたき台生成数 |
| `topItems` | TOP3メッセージ |
| `safetyNotice` | 安全通知文 |

### 画面ごとの強化内容

| 画面 | Phase 4.1の変更 |
|------|----------------|
| ホーム | Gmail要対応サマリーカード追加（重要A/本日中/銀行/請求/契約/返信たたき台の件数チップ） |
| AIコックピット | Gmailセクションを件数内訳＋TOP3詳細表示に強化（優先度バッジ・タイプバッジ・期限バッジ付き） |
| 今日の要対応 | GmailタスクカードにデモGmailバッジ・返信未送信バッジ追加、モーダルに元データ・受信日時・推定重要度・書き込み禁止の明示 |
| AI相談 | Gmailショートカット回答をmockGmail実データに基づく詳細内容に強化 |
| 設定 | 常時表示のGmail読み取りテストカードを追加（本番準備モードOFF時でも確認可能） |

### 読み取りテストについて

設定画面の「Gmail読み取りテスト」ボタンは、mockGmailデータの件数を確認するものです。  
実際のGmailアカウントへのアクセスは行いません。テスト結果に「デモGmail5件から取得」と明示しています。

### 次フェーズ予定

**Phase 4-2**: Googleカレンダー読み取り専用連携

### 外部API未接続の確認

Phase 4.1においても外部サービスへの接続は一切行っていません。  
Gmail・Google Drive・LINE WORKS・Googleカレンダー・Googleスプレッドシート等へのアクセスはゼロです。  
すべての変更はフロントエンド内のmockデータ表示強化のみです。

---

## Phase 4 で追加した内容（Gmail読み取り専用連携）

### Gmail安全設計ポリシー

**Phase 4はGmail読み取り専用のみ。以下は未実装：**
- 送信・返信
- 下書き作成・更新
- 削除・アーカイブ
- 既読化・未読化
- ラベル変更
- スター付与・解除
- メールの移動

**社長承認前に外部へ送信されることはない。Gmailデータは画面表示とAI判定用にのみ使用。**

### Gmailサービス層（新規追加）

```
client/src/services/gmail/
├── types.ts        — GmailMessage / GmailDerivedTask / GmailConnectionStatus 型定義
├── mockGmail.ts    — デモGmailデータ5件（本番認証情報未設定時に使用）
├── gmailAnalyzer.ts— 件名・本文・送信者からタイプ・優先度・期限キーワード判定
├── gmailMapper.ts  — GmailMessage → GmailDerivedTask 変換（返信文たたき台生成含む）
└── gmailClient.ts  — 読み取り専用クライアント（書き込み系関数は存在しない）
```

**書き込み系処理はコードに存在しない。gmailClient.ts は読み取り関数のみを定義。**

### 本番接続に必要な環境変数（実際の値は未設定・コードに書かない）

```env
# Gmail読み取り専用スコープのみ
GMAIL_CLIENT_ID=（取得後に設定）
GMAIL_CLIENT_SECRET=（取得後に設定）
GMAIL_REDIRECT_URI=（取得後に設定）
GMAIL_READONLY_SCOPE=https://www.googleapis.com/auth/gmail.readonly
```

### mockGmailを使用していること

現時点では認証情報が未設定のため、`gmailClient.ts` は常に `mockGmail.ts` の仮データを返します。  
実際のGmailアカウントには接続していません。

### 画面への反映

| 画面 | Phase 4の変更 |
|------|-------------|
| 今日の要対応 | 「Gmailからの要対応」セクション追加（優先度A/Bのみ）、Gmail詳細モーダル（送信ボタンなし、返信文たたき台コピーのみ） |
| AIコックピット | TOP5の後に「Gmailからの要対応」シンプルリスト追加（デモバッジ付き） |
| AI相談 | 「📧 Gmailショートカット」横スクロールバー追加（5件のGmail特化クイック質問） |
| 設定 | デモモード/本番準備モードのインタラクティブトグル化、本番準備モードON時にGmail連携カード表示 |

### 設定画面のモード管理

- **デモモード ON（デフォルト）**: mockGmailデータを表示
- **本番準備モード ON**: Gmail連携カードが表示される（認証情報未設定のため「未接続」表示）
- Gmail連携カードでは読み取りテストが可能（認証情報なし時はmock結果を表示）

### 次フェーズ予定

**Phase 4-2**: Googleカレンダー読み取り専用連携

---

## Phase 3 で追加した内容（AIコックピット）

### AIコックピット画面（新規追加）

社長が朝スマホを開いた瞬間に会社の状態を30秒で把握できる専用画面です。下部ナビの「🎯コックピット」またはホーム画面のブリーフィングカードから遷移できます。

#### 1. AIからの一言判断
今日フォーカスすべき事項をAIが自然文で提示します。優先フォーカスアイテムをタグ表示します。

#### 2. 会社健康スコア
会社の状態を0〜100点でスコア化し、A〜Dのグレードで表示します。
- 内訳：資金繰り / 粗利率 / 未請求 / 事故対応 / 人員配置 / 営業の6カテゴリ
- 各カテゴリは good / warning / danger / normal で色分け
- なぜその点数なのかのコメントを表示
- **現時点では仮データ。freee・TKC・Gmail連携後はリアルタイム計算される予定**

#### 3. 今日の優先順位 TOP 5
AIが考えた優先順位を5件表示します。各アイテムには以下が含まれます：
- 件名・重要度（最優先/重要/通常）・期限・カテゴリ
- なぜ優先すべきかの理由
- 推奨アクション
- ワンタップ実行ボタン群

#### 4. ワンタップ実行候補
各優先事項に対し、以下のボタンを表示します：
- 返信文を作る / 資料作成へ / 担当へ依頼文を作る / 予定登録案を作る / 詳細を見る / 保留にする
- タップするとボトムシートモーダルで仮生成結果を表示（コピー可能）
- **実際の送信・登録は行わない。すべて仮生成サンプル**

#### 5. 時系列ビュー（6タブ）
昨日 / 今日 / 明日 / 今週 / 来週 / 今月 の6タブで重要事項を表示します。

#### 6. AI会社検索
「人・案件・会社・車両・書類」をキーワード検索できます。
カテゴリ（人/案件/連絡/書類/予定/タスク）で色分けして表示します。
**現時点は仮インデックス。Gmail・LINE WORKS連携後はリアルタイム検索が実現**

### 追加したデータ型

```typescript
CompanyHealthScore   // 会社健康スコア（total, grade, breakdown, comment）
PriorityAction       // 優先アクション（rank, importance, deadline, reason, suggestions）
ActionSuggestion     // ワンタップ実行候補（type, draft）
TimelinePeriodData   // 時系列データ（6期間）
SearchResult         // 検索結果（category, title, sub, alertLevel）
AiJudgement          // AI判断一言（message, focusItems, generatedAt）
```

---

## Phase 3.5 で追加した内容（品質調整）

### 1. ナビゲーション再編成
ボトムナビを [ホーム / コックピット / **AI相談** / 要対応 / 経営] に変更。「作成」をナビから外し、AI相談タブを復活。

### 2. 作成画面へのアクセス経路を整備
「作成」はナビにはないが、以下から必ず遷移できます：
- ホーム画面「クイックアクション」の「✍️ 資料を作る」カード
- AI相談画面の「✍️ 作成依頼へ（文書・返信・指示文）」ボタン
- AIコックピット「ワンタップ実行」の「資料作成へ」「担当へ依頼文」ボタン

### 3. デモモード設定追加（設定画面）
設定画面の最上部に「動作モード設定」セクションを追加：
- デモモード: **ON**
- 本番準備モード: **OFF**
- 外部接続: **未接続**
- 読み取り専用予定: **ON**
- 書き込み禁止: **ON**

### 4. デモバナー表示（全主要画面）
「現在はデモデータ表示中 — 外部サービス未接続 · 書き込みなし」バナーを以下5画面の最上部に表示：
ホーム / AIコックピット / AI相談 / 今日の要対応 / 経営ダッシュボード

### 5. 法人名の修正
AI相談の福祉モード説明を「みらい介護サポート」→「一般社団法人みらい創造公社の就労継続支援B型『お結び』」に修正。

### 外部API未接続の明記
Phase 3.5においても外部サービスへの接続は一切行っていません。Gmail・Google Drive・LINE WORKS・Googleカレンダー・Googleスプレッドシート等へのアクセスはゼロです。すべての変更はフロントエンド内の仮データ修正のみです。

---

## Phase 2 で追加した内容

### 1. AIブリーフィングカード（ホーム）
朝のブリーフィングカードを追加。変化リスト（danger/warning/normal）と「今日最初にやること」を展開表示。AI相談・要対応への直接ボタン付き。

### 2. 状況カード8枚（ホーム）
今日の予定・昨日からの変化・重要通知・今日の現場・今日の入金・今日の支払・社員からのSOS・未請求アラートを2列グリッドで表示。danger/warningレベルで色分け。

### 3. AI相談チャット 6モード
- AI秘書（ネイビー）：メール要約・返信文作成
- AI経営（パープル）：資金繰り・損益分析
- AI現場（アンバー）：工程管理・現場サポート
- AI事務（グリーン）：書類・請求・スケジュール
- AI営業（レッド）：見積・提案・顧客対応
- AI福祉（ピンク）：一般社団法人みらい創造公社の就労継続支援B型「お結び」

タブ切替時に各モードのウェルカムメッセージを表示。モード別のキーワードマッチングで仮応答を返す。

### 4. 今日の要対応 詳細モーダル
タスクタイプバッジ（メール/LINE WORKS/承認/契約/請求/現場/事故/銀行/福祉）と優先度・ステータスを表示。「詳細・返信文を見る」ボタンでボトムシートモーダルを開き、3タブ（概要・背景/返信文たたき台/次のアクション）に切り替えて確認できる。

### 5. 経営ダッシュボード拡張
- 13週資金繰り予測グラフ（入金/支出/残高の3色バー、横スクロール）
- 案件粗利ランキング（1〜5位、粗利率の色分け）
- 部署別利益（3部署）
- 財務指標グリッド（通常指標10件）

### 6. 作成依頼フォーム拡張
作成目的・相手・背景・内容・希望トーン・出力形式（チャット/Gmail下書き/Drive保存/Manus/Claude Code/Gemini）を選択してAI生成（現在は仮データ返答）。

### 7. 音声入力モーダル（接続準備中）
フローティングマイクボタン（橙色、右下）をタップするとボトムシートが出現。現在は「接続準備中」表示のみ。将来的な音声認識と連携予定。

### 8. 設定画面拡張
- データ連携ステータスバナー（読み取り専用ON・書き込み禁止ON・外部接続未接続）
- 接続予定ロードマップ（8フェーズ）
- API連携ポイント一覧（開発者向け）

---

## 外部データへの接触について

**Phase 3においても外部サービスへの接続は一切行っていません。**

- Gmail、LINE WORKS、freee、Google Drive、Googleカレンダー、Googleスプレッドシート、TKC等の既存データへの読み取り・書き込みはゼロです。
- AIコックピットに表示されるすべてのスコア・優先順位・検索結果は `client/src/data/mockData.ts` 内の仮データです。
- 会社健康スコアおよび優先順位エンジンは現時点では仮データ。実接続後に自動計算される予定です。
- ワンタップ実行ボタンが生成する文書もすべて仮サンプルです。実際の送信・保存は行いません。
- 外部連携は「連携予定」「接続準備中」として表示するのみです。

---

## 今後の接続順序（予定）

| フェーズ | 機能 | 対応時期 |
|---------|------|---------|
| ~~Phase 4~~ | ~~Gmail読み取り（サービス層構築）~~ | ✅ 完了 |
| ~~Phase 4.1~~ | ~~Gmail由来データ全画面表示強化~~ | ✅ 完了 |
| **Phase 5** | **Google OAuth + Gmail ReadOnly 実接続基盤** | ✅ 完了 |
| Phase 6 | Googleカレンダー読み取り | 次回 |
| Phase 7 | Google Drive検索 | 未定 |
| Phase 8 | Googleスプレッドシート読み取り | 未定 |
| Phase 9 | LINE WORKS通知受信 | 未定 |
| Phase 10 | Claude APIリアルタイム接続 | 未定 |
| 将来 | Gmail下書き作成（送信なし・人間承認必須） | 将来 |

**書き込み処理はすべて人間の最終確認を前提とし、自動送信・自動保存は行いません。**

---

### 今後のAPI連携ポイント

| 機能 | エンドポイント | プロバイダー |
|------|---------------|-------------|
| AI相談チャット | `POST /api/chat` | Claude API（ストリーミング対応予定） |
| 今日の要対応 | `GET /api/actions` | Gmail API + LINE WORKS API |
| 経営ダッシュボード | `GET /api/dashboard` | freee API + Google Sheets API |
| 作成依頼 | `POST /api/create` | Claude API（テンプレート別プロンプト） |
| 設定保存 | `PUT /api/settings` | ローカルDB（Phase 1はlocalStorage） |

### 技術スタック（フロントエンド）

- React 18 + TypeScript
- Vite 5
- 純CSS変数（外部CSSフレームワーク不使用）
- iPhone Safe Area対応（`env(safe-area-inset-*)` 使用）
- PWA対応（apple-mobile-web-app-capable設定済み）

---

このリポジトリは、最初からGmail、LINE WORKS、kintone、AI APIへ本番接続しません。Phase 1では、外部APIキーなしで動くローカルMVPを優先します。

## MVPの範囲

- メール・チャット本文の分析
- 1〜3行要約
- A/B/C優先度分類
- タスク抽出
- 担当者候補の判定
- 期限表現の抽出
- 返信要否判定
- 返信下書き作成
- クレーム、失注、粗利悪化、入金遅延、現場停止、人員不足、事故、契約、労務のリスク判定
- ローカルJSON保存
- 朝・昼・晩の社長向けレポート生成
- 将来的なGmail、LINE WORKS、kintone接続用のConnector設計

## やらないこと

- 個人LINE全トークの自動取得
- 個人LINEアプリのスクレイピング
- PC版LINEのRPA操作
- LINE通知の自動読み取り
- 私的会話のAI分析
- AIによる外部自動返信
- 金額、契約、納期の自動確定
- 社員の私的会話の分析
- 権限のないトークルームの読み取り
- 最初から全社員・全チャットを対象にすること
- 大規模な管理画面開発

個人LINE由来の業務連絡を扱う場合は、社長または担当者が必要な業務部分だけを `external_forward` として手入力・転記します。

## 技術スタック

- TypeScript
- Node.js 20+
- Hono
- ローカルJSON保存
- Vitest
- ESLint
- Prettier
- 将来的なCloud Run / Cloud Scheduler想定

## セットアップ

```bash
npm install
cp .env.example .env
npm run dev
```

起動後、以下でヘルスチェックします。

```bash
curl http://localhost:8787/health
```

## テスト・ビルド

```bash
npm test
npm run build
```

## 環境変数

主な環境変数は `.env.example` を参照してください。

Phase 1では以下だけで動きます。

```env
NODE_ENV=development
PORT=8787
ENABLE_DEV_ENDPOINTS=true
STORAGE_DRIVER=local
LOCAL_DB_PATH=./data/shacho-ai-local.json
AI_PROVIDER=mock
```

## APIエンドポイント

### GET /health

サービス状態を返します。

### POST /dev/analyze-text

任意の本文をAI分析し、保存せずにJSONを返します。

```bash
curl -X POST http://localhost:8787/dev/analyze-text \
  -H 'Content-Type: application/json' \
  -d '{
    "source":"manual_import",
    "senderName":"A社 田中様",
    "subject":"解体工事の見積依頼",
    "text":"A社から解体工事の見積を今日中に出してほしいと依頼。金額は概算でよいとのこと。"
  }'
```

### POST /dev/analyze-and-save

任意の本文をAI分析し、AI受信箱、AIタスク、返信下書きへ保存します。

```bash
curl -X POST http://localhost:8787/dev/analyze-and-save \
  -H 'Content-Type: application/json' \
  -d '{
    "source":"lineworks",
    "senderName":"工務部",
    "roomName":"現場配置・緊急対応ルーム",
    "text":"B現場で追加外注が必要。今日決めないと明日の作業が止まります。"
  }'
```

### GET /dev/inbox

保存されたAI受信箱を返します。

### GET /dev/tasks

保存されたAIタスクを返します。

### GET /dev/reply-drafts

保存された返信下書きを返します。

### POST /jobs/report/morning

朝レポートを生成します。

### POST /jobs/report/noon

昼レポートを生成します。

### POST /jobs/report/evening

夜レポートを生成します。

### POST /webhooks/lineworks

将来的なLINE WORKS Bot Webhook受信用です。Phase 1ではMockLineworksConnectorで正規化してローカル保存します。

## MessageSource

扱う `source` は以下だけです。

- `gmail`：会社メール
- `lineworks`：LINE WORKS業務チャット
- `manual_import`：社長または担当者による手入力
- `external_forward`：個人LINE、SMS、電話メモ等から必要部分だけを人間が転記したもの

## 優先度分類

- A：今日中に社長判断が必要
- B：担当者へ振れば進む
- C：記録のみ

Aの例：金額承認、値引き判断、クレーム、事故、現場停止、入金遅延、外注費追加、人員不足、失注リスク、契約条件、採用・退職・労務トラブル。

Bの例：見積作成、日程調整、資料送付、現場確認、通常問い合わせ、請求書確認、写真送付、社内確認依頼。

Cの例：完了報告、共有、参考情報、日常報告、既に対応済みの連絡。

## 自動送信禁止ルール

Phase 1では送信処理自体を作りません。返信下書きのみ生成します。

以下は将来的にも自動送信禁止です。

- 金額回答
- 値引き回答
- 契約条件
- 納期確約
- 謝罪文
- 責任認定
- クレーム対応
- 外注費承認
- 支払条件
- 入金督促
- 採用
- 退職
- 労務
- 事故
- 法的リスクがある内容

## ローカル保存

デフォルトでは `./data/shacho-ai-local.json` に保存します。

保存先は `Repository` interface で抽象化しています。

- `LocalRepository`：Phase 1の本命。ローカルJSON保存。
- `KintoneRepository`：将来接続用のスタブ。

## kintoneを使わない場合の運用

Phase 1では、APIで分析・保存・レポート生成まで確認します。kintone未経験でも動作検証できます。

確認順序：

1. `/dev/analyze-text` で分析精度を確認
2. `/dev/analyze-and-save` で保存確認
3. `/dev/inbox`、`/dev/tasks`、`/dev/reply-drafts` で保存結果確認
4. `/jobs/report/morning` でレポート確認

## 将来的なkintone接続案

kintoneは最初から社長が使う画面にせず、AI分析結果の台帳として使います。

想定アプリは3つです。

1. AI受信箱
2. AIタスク
3. 返信下書き

`src/connectors/kintone.ts` にフィールドコード定数とpayload変換を置いています。正式接続時は `KintoneRepository` を実装します。

## 将来的なGmail接続案

`src/connectors/gmail.ts` にConnector interfaceと正規化処理を置いています。

初期検索条件の候補：

- `newer_than:1d`
- `is:unread`
- 社長宛、社長CC
- 見積、請求、入金、支払、工事、解体、外構、依頼、至急、確認、クレーム、事故、追加、変更、キャンセル、契約

## 将来的なLINE WORKS接続案

`src/connectors/lineworks.ts` にWebhook正規化と送信mockを置いています。

初期対象ルーム候補：

- 社長AI管制塔
- 社長AI窓口
- 幹部ルーム
- 営業部ルーム
- 工務部ルーム
- 業務サポート部ルーム
- 現場配置・緊急対応ルーム

本番送信は最初はdry-runから始めます。

## Cloud Run / Cloud Scheduler想定

Cloud RunにはNode.js APIとしてデプロイします。Cloud Schedulerは以下のエンドポイントを朝昼晩に叩く想定です。

- `/jobs/report/morning`
- `/jobs/report/noon`
- `/jobs/report/evening`

本番化前に、Cloud Schedulerからの認証、devエンドポイント無効化、LINE WORKS送信dry-run解除を行います。

## セキュリティ注意事項

- APIキー、秘密鍵、トークンは `.env` またはSecret Managerで管理します。
- 本番APIキーをGitHubにpushしません。
- `ENABLE_DEV_ENDPOINTS=false` で `/dev/*` を無効化します。
- 個人LINEの全トーク取得はしません。
- 社員の私的会話は分析対象にしません。
- 最初から全社全チャットを対象にしません。
- AIは下書きまで。外部送信は人間承認を前提にします。

## 初期運用ルール

1. 最初は社長、業務サポート部、営業、工務、現場配置・緊急対応だけを対象にする。
2. 個人LINE由来の業務連絡は必要部分だけを手入力する。
3. 金額、契約、納期、謝罪、労務、事故は必ず人間確認にする。
4. 朝昼晩レポートは上位3〜5件に絞る。
5. 1週間は分析精度の確認に集中し、外部送信はしない。
