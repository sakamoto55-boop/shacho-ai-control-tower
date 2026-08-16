# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このリポジトリは「社長AI管制塔 Phase 1」です。会社メール、LINE WORKS、手入力された外部連絡をAIで分析し、要約・タスク抽出・返信下書き・A/B/C優先度分類・リスク判定・朝昼晩レポートを生成するローカルMVPです。

## 開発コマンド

```bash
npm install
cp .env.example .env      # 初回のみ。Phase 1はAPIキー不要（AI_PROVIDER=mock）
npm run dev               # tsx watch で src/server.ts を起動（デフォルト http://localhost:8787）
npm test                  # vitest run（全テスト）
npx vitest run tests/ai/analyzeMessage.test.ts   # 単一テストファイル
npx vitest run -t "テスト名"                      # テスト名で絞り込み
npm run test:watch        # watchモード
npm run build             # tsc（src/ のみ。tests/ はビルド対象外）
npm run lint              # eslint
npm run format            # prettier --write
```

CIは `.github/workflows/ci.yml` で `npm test` と `npm run build` を実行します。動作確認は `curl http://localhost:8787/health` から。READMEに全エンドポイントのcurl例があります。

## アーキテクチャ

### 分析パイプライン（中核フロー）

```
HTTPリクエスト (src/server.ts, Hono)
  → analyzeAndSaveMessage (src/jobs/analyzeIncomingMessages.ts)
    → analyzeMessage (src/ai/analyzeMessage.ts) が AIProvider で分析
    → buildInboxRecord / buildTaskRecords / buildReplyDraftRecord でレコード化
    → Repository へ保存（AI受信箱・AIタスク・返信下書きの3種）
```

- `src/ai/providers/`：`AIProvider` interface に対し `MockAIProvider`（デフォルト・APIキー不要）、`AnthropicProvider`、`OpenAIProvider` の3実装。`AI_PROVIDER` 環境変数（`mock` | `anthropic` | `openai`）で切替。interfaceは `analyzeMessage` / `analyzeSnsInquiry` / `generateSnsPost` の3メソッド。
- `MockAIProvider` は `src/domain/priorityRules.ts`（キーワードベースのA/B/C分類）と `src/domain/riskRules.ts`（リスク判定）を使う。分類ロジックの変更はまずここに入れ、実AIプロバイダのシステムプロンプトと整合させる。
- SNS用のプロンプトは `src/ai/providers/snsPrompts.ts` に集約し、AnthropicProviderとOpenAIProviderで共有する。判断基準を変えるときは `src/domain/leadRules.ts` / `snsContentRules.ts` のルールと合わせて更新すること。
- `src/domain/types.ts` が全型の起点。`MessageSource` は `gmail` | `lineworks` | `manual_import` | `external_forward` の4種のみ。SNS反響もここを増やさず、`external_forward` + `originalChannel: 'sns'` で表す。
- `src/repositories/`：`Repository` interface に対し `LocalRepository`（JSON保存、デフォルト `./data/shacho-ai-local.json`）と `KintoneRepository`（将来用スタブ）。`STORAGE_DRIVER` で切替。
- `src/connectors/`：Gmail / LINE WORKS / kintone の将来接続用。Phase 1は全てmock実装（LINE WORKS送信は dry-run 固定）。
- `src/reports/generateDailyReport.ts`：朝昼晩レポート。優先度A・高リスク・返信要否などのスコアリングで上位数件に絞る設計。
- 重複排除：`externalMessageId` がない入力は `source + receivedAt + senderName + normalizedText` のsha256で生成。

### chatHistory と送信者区別（重要な仕様）

`AnalyzeMessageInput.chatHistory`（`ChatMessage[]`）は会話ログを渡すための配列で、各メッセージに `senderType: 'president' | 'other'` を持つ。

- `senderType='president'`（社長自身の発言）は背景情報として扱い、タスク・返信下書きの対象にしない。
- 会話の最後の発言者が社長なら `replyNeeded: false`。
- この規則は `MockAIProvider` のロジックと、`AnthropicProvider` / `OpenAIProvider` のシステムプロンプト（日本語）の両方に実装されている。変更時は3プロバイダとも揃えること。

### SNS集客・収益化パイプライン

```
SNS反響 (src/connectors/sns.ts で正規化)
  → ingestSnsInquiry (src/jobs/snsLeadPipeline.ts)
    → provider.analyzeSnsInquiry で事業判定・受注確度・見込み金額・スパム判定
    → InboxRecord（source=external_forward, originalChannel=sns, riskType=lost_order）
    → LeadRecord / 一次対応TaskRecord / ReplyDraftRecord（waiting）

投稿カレンダー
  buildSnsPostPlan (src/domain/snsContentRules.ts) で曜日テーマ×事業ローテーション
  → planSnsPosts (src/jobs/snsPostJobs.ts) で下書き生成・保存
  → approveSnsPostDraft（人の承認）→ publishApprovedSnsPosts（Phase 1は常にdry-run）

追客
  followUpLeads (src/jobs/snsLeadPipeline.ts) が追客日超過リードにタスク生成
  温度感別の間隔（hot=1日 / warm=3日 / cold=7日）、上限5回で nurturing へ
```

- 受注確度・見込み金額・スパム判定のルールは `src/domain/leadRules.ts`。金額は `AVERAGE_ORDER_VALUE_YEN`（事業別平均受注単価）× 規模係数の概算で、確定値ではない。
- 投稿の景表法チェックは `src/domain/snsContentRules.ts` の `checkAdCompliance`。指摘が出た下書きは `needs_revision` となり承認できない。
- 集客レポートは `src/reports/generateRevenueReport.ts`。SNS反響は既存のAI受信箱にも入るため、朝昼晩レポートにも自然に載る。

### 業種コンテキスト

建設・解体・外構・不動産・福祉の5事業を前提とする。優先度分類の基準：

- A：今日中に社長判断が必要（クレーム、事故、現場停止、金額承認、値引き、入金遅延、至急案件など）
- B：担当者へ振れば進む（見積作成、日程調整、資料送付、通常問い合わせなど）
- C：記録のみ（完了報告、相槌、情報共有）

### docs/ のLCC業務アプリ（APIとは独立）

`docs/` にはGitHub Pages公開用の単一HTML完結アプリ（LCC統合見積システム `lcc.html`、原価管理 `lcc-cost.html`、ポータル `index.html`）がある。Vue3 + Tailwind をCDN読み込みし、ビルドツール不使用。ルートの `lcc-redesigned.html` はその開発版。これらは `src/` のAPIとは独立しており、npmビルド・テストの対象外。

## コーディング規約

- ESM（`"type": "module"`）+ NodeNext解決のため、相対importは `.js` 拡張子必須（例：`from '../domain/types.js'`）。
- TypeScript strict。テストは `tests/` 配下に `*.test.ts`（vitest、tsconfigのビルド対象外）。
- コメント・プロンプト・レポート文言は日本語。
- APIキーや秘密情報をコードへ直書きしない。設定は `.env`（雛形は `.env.example`）。

## 重要な制約（変更禁止の方針）

- 個人LINEの直接連携は作らない。全トーク取得、スクレイピング、RPA操作、通知読み取りも作らない。
- 個人LINE由来の情報は、人間が必要部分だけを転記した `external_forward` として扱う。
- AIによる外部自動返信は作らない。返信は下書き生成まで（`approvalStatus: 'waiting'` で保存）。
- SNSへの自動投稿・DM自動返信も作らない。投稿は人が承認した下書きのみ扱い、Phase 1のコネクタは常にdry-run。`MockSnsConnector.publishPost` が実送信するように変えない。
- SNS返信下書きの `ngReasons` には必ず `SNS_REPLY_HUMAN_CHECK_REASON`（人の確認が必要）を残す。`buildLeadReplyDraftRecord` が保証しているので外さない。
- 投稿下書きは `checkAdCompliance` を通し、指摘があれば承認できないようにする。誇大広告・価格の言い切りを出さない。
- 金額、契約、納期、謝罪、責任認定、外注費、労務、事故は自動確定しない（`MockAIProvider` の `dangerousReplyWords` と各プロバイダの禁止事項プロンプトに反映済み）。
- Phase 1ではUIや管理画面を作らない（`docs/` のLCCアプリは別系統の既存物）。
- `/dev/*` エンドポイントは `ENABLE_DEV_ENDPOINTS=false` または `NODE_ENV=production` で無効化される。この挙動を壊さない。

## やるべきでないこと

- 大規模な認証システムを作る
- 本番APIキーを要求する
- kintone前提の実装にする
- Gmail/LINE WORKS本番接続を先に進める
- 個人LINEを直接読む設計にする
- 管理画面を先に作る

## 優先順位（判断に迷った場合）

1. ローカルで動くAPI
2. MockAIProviderによる分析の形
3. LocalRepositoryによる保存
4. 朝昼晩レポート生成
5. テスト
6. README整備
7. 将来Connectorの骨組み

Phase 1の目的である「メッセージ分析、タスク抽出、返信下書き、リスク判定、朝昼晩レポート」を優先してください。
