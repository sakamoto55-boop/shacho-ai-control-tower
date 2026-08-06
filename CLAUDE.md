# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このリポジトリは「社長AI管制塔 Phase 1」です。会社メール、LINE WORKS、手入力された外部連絡をAIで分析し、要約・タスク抽出・返信下書き・A/B/C優先度分類・リスク判定・朝昼晩レポートを生成するローカルMVPです。UIは持たず、HTTP API（Hono）とJSONファイル保存だけで完結します。

## 開発コマンド

```bash
npm install
cp .env.example .env      # 初回のみ。Phase 1はAPIキー不要（AI_PROVIDER=mock）
npm run dev               # tsx watch で src/server.ts を起動（デフォルト http://localhost:8787）
npm test                  # vitest run（全テスト。現在4ファイル17テスト）
npx vitest run tests/ai/analyzeMessage.test.ts   # 単一テストファイル
npx vitest run -t "テスト名"                      # テスト名で絞り込み
npm run test:watch        # watchモード
npm run build             # tsc（src/ → dist/。tests/ はビルド対象外）
npm start                 # node dist/server.js（build後）
npm run lint              # eslint
npm run format            # prettier --write
```

- CIは `.github/workflows/ci.yml`（Node 20）で `npm install` → `npm test` → `npm run build`。lintはCI未接続なのでローカルで走らせる。
- 動作確認は `curl http://localhost:8787/health` から。READMEに全エンドポイントのcurl例がある。
- `Dockerfile` はマルチステージ（deps → build → runner）で `NODE_ENV=production` 固定。この状態では `/dev/*` が無効になる点に注意。

## リポジトリ構成

```
src/
  server.ts                  Honoアプリ + ルーティング（エントリポイント）
  ai/
    analyzeMessage.ts        createAIProvider()（AI_PROVIDERで切替）と analyzeMessage()
    providers/
      AIProvider.ts          interface（analyzeMessage の1メソッドのみ）
      MockAIProvider.ts      デフォルト。ルールベース。APIキー不要
      AnthropicProvider.ts   @anthropic-ai/sdk。model: claude-opus-4-5
      OpenAIProvider.ts      openai。model: gpt-4o
  domain/
    types.ts                 全型の起点
    priorityRules.ts         キーワードベースのA/B/C分類
    riskRules.ts             リスク種別・レベル判定
  jobs/
    analyzeIncomingMessages.ts  analyzeAndSaveMessage / buildXxxRecord / 一括取込
    generateReports.ts          レポート生成 + LINE WORKS送信（dry-run）
  reports/
    generateDailyReport.ts   朝昼晩レポート本体（スコアリング + 文面組み立て）
    formatLineworksReport.ts 現状は report.text をそのまま返すだけの薄いラッパ
  repositories/
    Repository.ts            interface
    LocalRepository.ts       JSONファイル保存（デフォルト）
    KintoneRepository.ts     将来用スタブ（全メソッドがthrow）
    createRepository.ts      STORAGE_DRIVER で切替
  connectors/
    gmail.ts                 normalizeGmailMessage + Mockコネクタ（空配列を返す）
    lineworks.ts             Webhook正規化 + 送信（常に dryRun: true）
    kintone.ts               フィールドコード定義 + payload変換関数のみ
  utils/
    date.ts                  ISO日付ユーティリティ + parseJapaneseDueDate
    hash.ts                  sha256
    textNormalize.ts         normalizeText / stripQuotedEmail / htmlToPlainText
tests/                       vitest。fixtures/messages.ts に日本語サンプル入力
docs/                        GitHub Pages公開用のLCC業務アプリ（src/ とは無関係）
data/                        LocalRepositoryのJSON保存先（.gitignore済み）
```

## アーキテクチャ

### 分析パイプライン（中核フロー）

```
HTTPリクエスト (src/server.ts, Hono)
  → analyzeAndSaveMessage (src/jobs/analyzeIncomingMessages.ts)
    → analyzeMessage (src/ai/analyzeMessage.ts) が AIProvider で分析
    → buildInboxRecord / buildTaskRecords / buildReplyDraftRecord でレコード化
    → Repository へ保存（AI受信箱・AIタスク・返信下書きの3種）
    → StoredMessageBundle { inbox, tasks, replyDraft? } を返す
```

- `AIProvider` は `analyzeMessage(input) => AnalyzeMessageResult` の1メソッドのみ。プロバイダ実装は `MockAIProvider`（デフォルト・APIキー不要）、`AnthropicProvider`、`OpenAIProvider` の3つで、`AI_PROVIDER` 環境変数（`mock` | `anthropic` | `openai`）で切替。
- `MockAIProvider` は `src/domain/priorityRules.ts`（A/B/C分類）と `src/domain/riskRules.ts`（リスク判定）を使う。分類ロジックの変更はまずここに入れ、実AIプロバイダのシステムプロンプトと整合させる。
- 実プロバイダはレスポンス本文から `/\{[\s\S]*\}/` でJSONを抜き出し、そのまま `AnalyzeMessageResult` にキャストする（スキーマ検証はしていない）。型を変更したらプロンプト内のJSON雛形も必ず同時に直すこと。
- `src/domain/types.ts` が全型の起点。`MessageSource` は `gmail` | `lineworks` | `manual_import` | `external_forward` の4種のみ。
- `src/repositories/`：`Repository` interface に対し `LocalRepository`（JSON保存、デフォルト `./data/shacho-ai-local.json`）と `KintoneRepository`（将来用スタブ・生成時に環境変数を要求し全メソッドがthrow）。`STORAGE_DRIVER` で切替。
- `src/connectors/`：Gmail / LINE WORKS / kintone の将来接続用。Phase 1は全てmock実装（Gmailは空配列、LINE WORKS送信は `{ dryRun: true }` 固定）。

### レコード生成の規則（jobs/analyzeIncomingMessages.ts）

- `InboxRecord.status` は分析結果から決まる：`replyNeeded` なら `draft_created`、タスクがあれば `task_created`、どちらでもなければ `unreviewed`。
- 重複排除：`externalMessageId` がない入力は `source + receivedAt + senderName + normalizedText` のsha256で生成。`LocalRepository.createInboxRecord` は `source` + `externalMessageId` が一致する既存レコードがあれば新規追加せず既存を返す（タスク・返信下書きには重複排除がない）。
- 返信下書きは `replyDraft.needed` が true のときだけ作られ、必ず `approvalStatus: 'waiting'` で保存される。
- `analyzeIncomingMessages()` は一括取込用。優先度Aまたは高リスクを検知すると LINE WORKS へ即時通知を送る（現状dry-run）。

### chatHistory と送信者区別（重要な仕様）

`AnalyzeMessageInput.chatHistory`（`ChatMessage[]`）は会話ログを渡すための配列で、各メッセージに `senderType: 'president' | 'other'` を持つ。

- `senderType='president'`（社長自身の発言）は背景情報として扱い、タスク・返信下書きの対象にしない。`MockAIProvider` は `chatHistory` がある場合 `other` の発言だけを連結して分析対象テキストにする。
- 会話の最後の発言者が社長なら `replyNeeded: false`（`ngReasons` に理由を入れて返す）。
- `chatHistory` がない場合は `text` を相手からのメッセージとして扱う。
- この規則は `MockAIProvider` のロジックと、`AnthropicProvider` / `OpenAIProvider` のシステムプロンプト（日本語）の両方に実装されている。変更時は3プロバイダとも揃えること。
- 経緯と設計意図は `CLAUDE_HANDOFF_LINEWORKS_FIX.md` に残っている。

### 朝昼晩レポート（reports/generateDailyReport.ts）

- `morning` / `noon` / `evening` の3種。件数サマリー（`ReportCounts` の7項目）＋「最優先案件」「確認待ち返信下書き」「期限・滞留タスク」を各3件まで。
- 抽出はスコアリング：受信箱は 優先度A(100) / 高リスク(80) / 要返信(30) / 未確認(20)、タスクは 優先度A(100) / 社長判断要(60) / 期限超過(50) / 本日期限(30)。
- `noon` のみ優先度Cを最優先案件の候補から除外する。
- 空リストは `'なし'` と表示。文面は全て日本語で、書式を変えるテストが `tests/reports/generateDailyReport.test.ts` にある。
- 集計は `getInboxRecordsByDateRange()` 等の全件取得メソッドを使う（`getOpenTasks()` 等は現状レポートからは使われていない）。

### APIエンドポイント（src/server.ts）

| メソッド | パス | 用途 | dev制限 |
| --- | --- | --- | --- |
| GET | `/health` | 稼働確認。storage / aiProvider を返す | なし |
| POST | `/dev/analyze-text` | 分析のみ（保存しない） | あり |
| POST | `/dev/analyze-and-save` | 分析して3種レコードを保存 | あり |
| GET | `/dev/inbox` | 受信箱の全件 | あり |
| GET | `/dev/tasks` | タスクの全件 | あり |
| GET | `/dev/reply-drafts` | 返信下書きの全件 | あり |
| POST | `/jobs/report/{morning,noon,evening}` | レポート生成 + 送信（dry-run） | なし |
| POST | `/webhooks/lineworks` | Webhook受信 → 正規化 → 分析・保存 | なし |

- `/dev/*` は `ENABLE_DEV_ENDPOINTS=false` または `NODE_ENV=production` で無効化される。`/jobs/*` と `/webhooks/*` はこの制限の対象外。
- エラーは全て `{ error: string }` + HTTP 400 で返す形に揃っている。
- `app` は named export。テストから直接 `app.fetch` を叩ける。サーバ起動は `import.meta.url === file://${process.argv[1]}` のときだけ。

### 環境変数（.env.example が雛形）

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `PORT` | 8787 | 待ち受けポート |
| `NODE_ENV` | development | `production` で `/dev/*` 無効 |
| `ENABLE_DEV_ENDPOINTS` | true | `false` で `/dev/*` 無効 |
| `STORAGE_DRIVER` | local | `local` \| `kintone` |
| `LOCAL_DB_PATH` | ./data/shacho-ai-local.json | JSON保存先 |
| `AI_PROVIDER` | mock | `mock` \| `anthropic` \| `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 空 | Phase 1では不要 |
| `KINTONE_*` / `GOOGLE_*` / `LINEWORKS_*` | 空 | 将来接続用。Phase 1では未使用 |

### 業種コンテキスト

建設・解体・外構・不動産・福祉の5事業を前提とする。優先度分類の基準：

- A：今日中に社長判断が必要（クレーム、事故、現場停止、金額承認、値引き、入金遅延、至急案件など）
- B：担当者へ振れば進む（見積作成、日程調整、資料送付、通常問い合わせなど）
- C：記録のみ（完了報告、相槌、情報共有）

リスク種別は `complaint` / `accident` / `site_stop` / `payment_delay` / `manpower_shortage` / `gross_profit` / `contract` / `labor` / `lost_order` / `none`。`riskRules.ts` は上から順に最初にマッチしたものを返す**先勝ち**なので、キーワードを足すときは判定順序の影響を確認すること。

### docs/ のLCC業務アプリ（APIとは独立）

`docs/` にはGitHub Pages公開用の単一HTML完結アプリがある。

- `docs/index.html`：ポータル（LCC株式会社 統合業務システム）
- `docs/lcc.html`：統合見積システム（Vue3 + Tailwind + Chart.js をCDN読み込み）
- `docs/lcc-cost.html`：原価管理
- ルートの `lcc-redesigned.html` は `docs/lcc.html` の開発版（Chart.js未導入など差分あり）

ビルドツール不使用・依存はCDNのみ。`src/` のAPIとは独立しており、npmビルド・テスト・lintの対象外。

## テスト

- `tests/` 配下に `*.test.ts`（vitest、tsconfigのビルド対象外）。`vitest.config.ts` の `include` は `tests/**/*.test.ts`。
- `tests/fixtures/messages.ts` に日本語サンプル入力（見積依頼、現場停止、クレーム、入金遅延、完了報告、chatHistoryあり／なし）。新しい分類ルールを足すときはここにケースを追加してから実装する。
- `tests/ai/analyzeMessage.test.ts` が中核。優先度・リスク種別・`ownerType`・`replyDraft.tone`・`ngReasons` の有無まで検証している。
- `tests/repositories/LocalRepository.test.ts` は一時ファイルパスを使う。`tests/repositories/kintonePayload.test.ts` は変換関数のみで実接続しない。
- `tests/fixtures/messages.ts.bak` はテスト対象外の残置ファイル。

## コーディング規約

- ESM（`"type": "module"`）+ NodeNext解決のため、相対importは `.js` 拡張子必須（例：`from '../domain/types.js'`）。
- TypeScript strict。`rootDir` は `src` なので、`src/` から `tests/` を参照してはいけない。
- コメント・プロンプト・レポート文言・タスク名は日本語。
- APIキーや秘密情報をコードへ直書きしない。設定は `.env`（雛形は `.env.example`）。
- 日付は `src/utils/date.ts` に集約。`todayIsoDate()` は `toISOString()` ベースでUTC基準のため、JST運用では日付境界がずれる既知の制約がある（「今日中」の期限や朝レポートの判定に影響）。日付ロジックを触るときはこの前提を確認すること。

## 重要な制約（変更禁止の方針）

- 個人LINEの直接連携は作らない。全トーク取得、スクレイピング、RPA操作、通知読み取りも作らない。
- 個人LINE由来の情報は、人間が必要部分だけを転記した `external_forward` として扱う。
- AIによる外部自動返信は作らない。返信は下書き生成まで（`approvalStatus: 'waiting'` で保存）。
- 金額、契約、納期、謝罪、責任認定、外注費、労務、事故は自動確定しない（`MockAIProvider` の `dangerousReplyWords` と各プロバイダの禁止事項プロンプトに反映済み）。
- LINE WORKS送信は常に dry-run。実送信を実装しない。
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
