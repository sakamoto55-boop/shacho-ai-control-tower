# FINAL_ARCHITECTURE.md — AI社長室 最終アーキテクチャ設計書

> 本番運用に入る前の最終設計（確定版）  
> ベース: v1.0.0 MVP + Phase 11（Gmail ReadOnly 本番接続）  
> 2026-06-27

---

## 1. 全体構成図

```
┌─────────────────────────────────────────────────────────────┐
│  社長（iPhone / スマホブラウザ）                              │
│   https://sakamoto55-boop.github.io/shacho-ai-control-tower/ │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  AI社長室 フロントエンド（React + TypeScript + Vite / SPA）  │
│                                                             │
│  画面層: ホーム / AIコックピット / 今日の要対応 /             │
│          AI相談 / 経営ダッシュボード / 設定                  │
│            ▲                                                 │
│  AI Engine層: aiOrchestrator が全Providerを横断統合          │
│            ▲                                                 │
│  Provider層: Inbox / Schedule / File / BusinessData /        │
│              Notification（統一型 Unified に正規化）          │
│            ▲                                                 │
│  サービス層: gmail / calendar / drive / sheets / lineworks   │
│              （fetcher = GET専用 / mapper / cache / mock）    │
└───────────────────────────┬─────────────────────────────────┘
        │ 読み取りのみ（書き込みAPIなし）
        ▼
┌─────────────────────────────────────────────────────────────┐
│  外部サービス                                                │
│  Gmail API（gmail.readonly・Phase 11接続）                   │
│  Calendar / Drive / Sheets API（Phase 12以降・現デモ）       │
│  LINE WORKS（バックエンド必須・現デモ）                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. ツール別の役割

| ツール | 役割 | 課金 |
|--------|------|------|
| **ChatGPT** | 日々の実務運用。Gmail/Calendar/Drive の確認、要約、返信文の下書き作成。社長の「手元の相談相手」 | サブスク（任意）|
| **Claude Code** | AI社長室 専用アプリの開発・改修・本番接続実装。コードを書く担当 | 開発時のみ |
| **Gemini** | Google Cloud 設定・OAuth・Workspace 連携の補助。Google系の設定相談 | 無料枠中心 |
| **Manus** | 資料・マニュアル・デザイン・図版の補助作成 | 任意 |
| **GitHub** | ソースコードの保管・バージョン管理・公開（GitHub Pages）| 公開リポジトリは無料 |
| **Google** | 実データ提供元（Gmail/Calendar/Drive/Sheets）。OAuth 認証基盤 | 読み取りは無料枠 |
| **LINE WORKS** | 社内通知・連絡の取り込み元（将来）。本番はバックエンド必須 | プラン次第 |

> 設計思想: 「ChatGPTで今すぐ実務を回す」×「Claude Codeで専用アプリを育てる」の二段構え。

---

## 3. Provider 構造（確定）

| Provider | 統一型 | データ元 | 状態 |
|---------|-------|---------|------|
| Inbox Provider | `UnifiedInboxItem` | Gmail + LINE WORKS受信箱 | Gmail本番(Phase11) / LW デモ |
| Schedule Provider | `UnifiedScheduleItem` | Google Calendar | デモ |
| File Provider | `UnifiedFileItem` | Google Drive | デモ |
| BusinessData Provider | `UnifiedBusinessMetric` | Google Sheets | デモ |
| Notification Provider | `UnifiedNotification` | LINE WORKS通知 | デモ |

**原則**: 画面は Provider 経由でのみデータを受け取る。サービスを直接呼ばない。全 Unified 型は `readOnly: true / writeEnabled: false`。

---

## 4. AI Engine 構造（確定）

```
aiOrchestrator.runOrchestrator()
  ├── crossProviderContext  … 全Provider横断コンテキスト（銀行/請求/事故/人員/現場）
  ├── companyHealthEngine   … 会社健康スコア（9カテゴリ・グレードA〜D）
  ├── decisionEngine        … 今日の優先判断 TOP7
  ├── actionDraftEngine     … 社長承認用 下書き（最大6件・externalSendDisabled）
  └── executiveBriefing     … 朝ブリーフィング
        ↓
  OrchestratorResult → 各画面へ（useMemo配布）
```

補助エンジン: normalizer / priorityEngine / riskEngine / searchEngine / approvalEngine（承認ゲート）。

---

## 5. 社長承認フロー（確定・現状はUIと型のみ）

```
AIが下書き生成（actionDraftEngine）
   ↓ ActionDraft（externalSendDisabled: true / saveDisabled: true / readOnly: true）
社長が画面で確認（AIコックピット 承認キュー amber）
   ↓ 承認 / 修正 / 棄却 / 委任（現状はUI表示のみ）
   ↓
【Phase 13以降】承認後実行（バックエンド経由・人間最終確認必須）
```

**現バージョンでは外部実行は一切行わない。** 承認＝記録・確認まで。送信・保存・実行は将来フェーズ。

---

## 6. 本番接続時の構成（目標形）

```
社長スマホ
   ↓
AI社長室 フロントエンド（GitHub Pages）
   ↓ 認証・読み取りリクエスト
┌─────────────── バックエンド Proxy（Phase 12〜）───────────────┐
│  Node.js / Cloud Run（または同等）                            │
│  ・OAuth トークン交換・保管（client_secret はここだけ）        │
│  ・HttpOnly Cookie でセッション管理（XSS対策）                 │
│  ・Gmail / Calendar / Drive / Sheets 読み取り中継             │
│  ・LINE WORKS 読み取り中継（CLIENT_SECRET 管理）              │
└──────────────────────────┬───────────────────────────────────┘
                           ↓ 読み取りのみ
              Google API / LINE WORKS API
```

**現状（v1.0.0 + Phase11）**: フロントエンド直結（client_secret 不使用・gmail.readonly のみ）。  
**目標**: バックエンドProxy を挟み、秘密情報をサーバー側に隔離して安全化。

---

## 7. 安全設計の固定原則

1. 書き込みAPIは実装しない（送信/返信/削除/既読化/ラベル変更なし）
2. スコープは readonly のみ。FORBIDDEN_SCOPES は永久に使わない
3. client_secret はフロントエンドに置かない（バックエンドProxyのみ）
4. 社長承認前に外部実行しない（externalSendDisabled を外さない）
5. 金額/契約/納期/謝罪/責任認定/外注費/労務/事故 は自動確定しない
6. `.env` はコミットしない（秘密情報はリポジトリに入れない）
