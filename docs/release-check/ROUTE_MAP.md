# ROUTE_MAP.md — 画面遷移と主要導線

> 最終更新: Phase 11 — Gmail ReadOnly 本番接続（2026-06-27）

---

## Phase 11 追加: Gmail 本番接続の導線

```
設定画面（Settings）
├── Google アカウント接続カード
│     └── 「🔐 Googleアカウントで接続（Gmail ReadOnly のみ）」
│           ↓ googleAuth.startOAuthFlow()（scope = gmail.readonly）
│         Google 認証画面 → 同意 → リダイレクト
│           ↓ App.tsx → googleAuth.handleCallback()
│         「✓ 接続済み」表示
│
└── Gmail読み取りテストカード
      ├── バッジ: 本番Gmail / デモGmail（接続状態で切替）
      ├── 接続状態 / モード / 取得件数 / 最終取得日時
      └── 「📥 読み取りテスト」→ 実メール or デモを取得表示

AIコックピット（CockpitScreen）
└── Gmailからの要対応セクション
      ├── 接続時: 「本番Gmail接続」バッジ・実データ表示
      └── 未接続: 「デモGmail」バッジ・mockGmail表示
      ※ Calendar/Drive/Sheets/LINE WORKS はデモのまま
```

---

## Phase 10 追加: 画面更新内容

### AIコックピット（CockpitScreen.tsx）— Phase 10 追加セクション

```
AIコックピット（CockpitScreen.tsx）
├── [既存] 会社健康スコア（companyHealthEngine）
├── [Phase 10] 🎯 今日の優先判断（DecisionItem TOP5・emerald強調なし）
│      └── DecisionItem カード（rank / urgency / reason / suggestedAction）
├── [Phase 10] ⚡ 今すぐ対応（immediateActions / critical=赤 / high=orange）
├── [Phase 10] ✅ 社長承認キュー（ActionDraft amber セクション）
│      └── ActionDraft カード（4ボタン：承認・修正・棄却・委任 / UIのみ）
└── [既存] 💬 LINE WORKS通知セクション（ティール）
```

### 今日の要対応（TodayActions.tsx）— Phase 10 タブ追加

```
今日の要対応（TodayActions.tsx）
├── タブ: [Phase 10] 🤖 AI優先順（emerald）← 新規
│      └── DecisionItem カード（TOP7）
├── タブ: Gmail（青）
│      └── Gmailタスクカード
└── タブ: 💬 LINE WORKS（ティール）
       └── 通知カード / 受信箱カード
```

### AI相談（AiChat.tsx）— Phase 10 ショートカットバー追加

```
AI相談（AiChat.tsx）
├── [Phase 10] indigo ショートカットバー（#EEF2FF）← 新規
│      └── 8件ボタン（AI優先順位TOP5 / 健康スコア / 緊急対応 / 資金繰り 等）
├── [既存] LINE WORKS ショートカットバー（ティール）
├── [既存] Gmail ショートカットバー（青）
└── テキスト入力 + 送信
```

### 経営ダッシュボード（Dashboard.tsx）— Phase 10 カード追加

```
経営ダッシュボード（Dashboard.tsx）
├── [Phase 10] 🏢 会社健康度カード ← 新規
│      ├── 総合グレード（A/B/C/D）+ スコア（0-100）
│      ├── 9カテゴリグリッド（資金繰り/粗利率/未請求/未回収/事故/人員/売上/社内SOS/予定負荷）
│      └── 主要リスク警告バー（amber）
└── [既存] 月次サマリーセクション
```

---

## 画面遷移図

```
起動
  │
  ├── [?code=...&state=...] ← Google OAuth コールバック
  │         │
  │         ▼
  │   App.tsx useEffect
  │   googleAuth.handleCallback()
  │         │
  │         ▼
  │   設定画面（認証結果表示）
  │
  └── [通常起動]
            │
            ▼
         ホーム画面（初期画面）
            │
  ┌─────────┼──────────────────────────────────┐
  │         │                                  │
  ▼         ▼                                  ▼
AIコックピット   Gmail要対応サマリー                 クイックアクション
（ブリーフィング  「要対応を見る→」                    4枚カード
  カードボタン）        │                              │
      │           ▼                         ┌───┼───┐
      │      今日の要対応                    │   │   │
      │           │                         ▼   ▼   ▼
      │      [Gmailタスク]           AI相談 作成 経営
      │           │                 チャット 依頼 ダッシュ
      │      [詳細モーダル]                         ボード
      │      ・返信文たたき台
      │      ・推奨アクション
      │      ・安全通知
      │
      └─── 状況カード8枚 ──→ 各詳細画面（future）
```

---

## ボトムナビゲーション（5タブ）

```
┌──────┬──────────┬────────┬──────┬──────┐
│ ホーム │コックピット│ AI相談 │ 要対応 │ 経営 │
│  🏠  │   🎯    │  🤖  │  ⚡  │  📈  │
└──────┴──────────┴────────┴──────┴──────┘
```

| タブ | Screen 型 | コンポーネント |
|-----|-----------|-------------|
| ホーム | `home` | `Home.tsx` |
| コックピット | `cockpit` | `CockpitScreen.tsx` |
| AI相談 | `chat` | `AiChat.tsx` |
| 要対応 | `actions` | `TodayActions.tsx` |
| 経営 | `dashboard` | `Dashboard.tsx` |

---

## ヘッダーからの遷移

| ボタン | 遷移先 |
|-------|-------|
| ⚙️（設定アイコン） | `settings`（Settings.tsx） |

---

## 設定画面からの戻り

| アクション | 動作 |
|-----------|------|
| 会社選択 | ホーム画面へ遷移（App.tsx `onCompanyChange`） |

---

## 画面内ナビゲーション（ページ遷移なし）

### ホーム画面
- AIブリーフィングカード「🎯 AIコックピットへ」→ `cockpit`
- AIブリーフィングカード「🤖 AIに相談」→ `chat`
- AIブリーフィングカード「⚡ 要対応へ」→ `actions`
- Gmail要対応サマリー「要対応を見る →」→ `actions`
- LINE WORKSカード「LINE WORKSの通知を確認する →」→ `actions`（Phase 9追加）
- クイックアクション各カード → 対応画面

### AIコックピット画面
- 「AIコックピット全画面へ」など → `cockpit`（内部タブ切替）
- ワンタップ実行「資料作成へ」→ `create`
- ワンタップ実行「担当へ依頼文」→ `create`

### AI相談画面
- 「✍️ 作成依頼へ（文書・返信・指示文）」→ `create`
- モード切替（AI秘書/経営/現場/事務/営業/福祉）→ 画面内タブ切替
- Gmail ショートカット → 画面内クイック入力

---

## OAuth 画面遷移（Phase 5 追加）

```
設定画面
  │「🔐 Googleアカウントで接続」タップ
  ▼
googleAuth.startOAuthFlow()
  │ PKCE生成 → sessionStorage保存 → Google URL 生成
  ▼
Google認証画面（外部ブラウザ）
  │ ユーザーがログイン・権限承認
  ▼
アプリへリダイレクト（?code=xxx&state=yyy）
  │
  ▼ App.tsx useEffect on mount
  ├── state 検証（sessionStorage）
  ├── code → token 交換（/token エンドポイント）
  ├── userinfo でメールアドレス取得
  └── localStorage にトークン保存
  │
  ▼ 設定画面（navigate('settings')）
「✓ 接続済み」表示
```

---

## 未実装の遷移（将来フェーズ）

| 画面 | 遷移 | 状態 |
|------|------|------|
| 今日の状況カード | 各詳細画面 | 一部のみ遷移先あり |
| Gmail詳細モーダル | 返信送信 | 永久禁止（書き込み禁止） |
| Gmail詳細モーダル | Gmail で開く | 未実装 |
