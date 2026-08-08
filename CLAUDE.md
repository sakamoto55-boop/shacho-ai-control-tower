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

- `src/ai/providers/`：`AIProvider` interface に対し `MockAIProvider`（デフォルト・APIキー不要）、`AnthropicProvider`、`OpenAIProvider` の3実装。`AI_PROVIDER` 環境変数（`mock` | `anthropic` | `openai`）で切替。
- `MockAIProvider` は `src/domain/priorityRules.ts`（キーワードベースのA/B/C分類）と `src/domain/riskRules.ts`（リスク判定）を使う。分類ロジックの変更はまずここに入れ、実AIプロバイダのシステムプロンプトと整合させる。
- `src/domain/types.ts` が全型の起点。`MessageSource` は `gmail` | `lineworks` | `manual_import` | `external_forward` の4種のみ。
- `src/repositories/`：`Repository` interface に対し `LocalRepository`（JSON保存、デフォルト `./data/shacho-ai-local.json`）と `KintoneRepository`（将来用スタブ）。`STORAGE_DRIVER` で切替。
- `src/connectors/`：Gmail / LINE WORKS / kintone の将来接続用。Phase 1は全てmock実装（LINE WORKS送信は dry-run 固定）。
- `src/reports/generateDailyReport.ts`：朝昼晩レポート。優先度A・高リスク・返信要否などのスコアリングで上位数件に絞る設計。
- 重複排除：`externalMessageId` がない入力は `source + receivedAt + senderName + normalizedText` のsha256で生成。

### chatHistory と送信者区別（重要な仕様）

`AnalyzeMessageInput.chatHistory`（`ChatMessage[]`）は会話ログを渡すための配列で、各メッセージに `senderType: 'president' | 'other'` を持つ。

- `senderType='president'`（社長自身の発言）は背景情報として扱い、タスク・返信下書きの対象にしない。
- 会話の最後の発言者が社長なら `replyNeeded: false`。
- この規則は `MockAIProvider` のロジックと、`AnthropicProvider` / `OpenAIProvider` のシステムプロンプト（日本語）の両方に実装されている。変更時は3プロバイダとも揃えること。

### 業種コンテキスト

建設・解体・外構・不動産・福祉の5事業を前提とする。優先度分類の基準：

- A：今日中に社長判断が必要（クレーム、事故、現場停止、金額承認、値引き、入金遅延、至急案件など）
- B：担当者へ振れば進む（見積作成、日程調整、資料送付、通常問い合わせなど）
- C：記録のみ（完了報告、相槌、情報共有）

### LCC COMMAND（src/command/ — 会話型AI経営管制OS）

`/command` 配下にマウントされる上位レイヤー。設計全文は `LCC_COMMAND.md` を参照。

- `src/command/engines/`：資金繰り予測・売上着地・営業漏れ検知・粗利分析・請求チェック・アラート・KPIの**決定論エンジン**（純関数）。数値計算をAIにさせない。
- `src/command/orchestrator/orchestrator.ts`：日本語の意図判定→Read Tool実行→【確認できた事実】/【AIの推測】を分離した根拠付き回答。データがなければ推測せず `UNKNOWN` を返す。
- `src/command/data/seed.ts`：Phase A用デモ正本。全日付が基準日 `asOf` からの相対で、テストは `asOf` 固定で決定論的に検証する。数値を変えるとテストの期待値（着地▲7.1%、A案件粗利24.8%等）が壊れるため必ず両方更新する。
- `src/command/tools/registry.ts`：Read/Write Tool分離。LEVEL 4以上のWriteは `ApprovalRequest`（承認待ち）必須で、承認後も Phase A は dry-run 固定。この挙動を壊さない。
- 法人スコープ（`group`/法人ID）の絞り込みは必ず `filterDatasetByScope` を通す。法人間データを混在させない。
- Decision（経営判断Memory）は `suppressAlertKinds` と `validUntil` で同種アラートを抑制し、期限後に再評価する。
- `docs/lcc-command.html`：Mobile First の会話中心UI（Vue3+Tailwind CDN）。デモ表示は `?demo=1` 明示時のみ。API障害時はデモ数値を出さずCONNECTION ERRORを表示する。
- Demo Fixture隔離：`LCC_COMMAND_MODE=production` ではソース未接続時にデモデータへフォールバックせず `DATA_UNAVAILABLE` を返す。この挙動と `tests/command/gate/` の隔離テストを壊さない。
- RBAC（`src/command/domain/rbac.ts`）はAPI側とOrchestrator（Tool実行前）の両方で強制。UIで隠すだけの権限制御を追加しない。
- 日付判定（今日・当月・期日）は `src/command/utils/jst.ts` を通しAsia/Tokyo基準。ISO文字列の `slice` で直接判定しない。

### Persistent Memory（src/command/memory/ — Phase M）

- Learning Safetyは `memory/store.ts` の `MemoryService.validate` で強制される。AI推測のFACT保存・DECISION独断確定・出典なし重要Memory・給与等実値の複製・履歴なし上書きは禁止。この検証を迂回してMemoryを直接保存しない。
- 記憶は物理削除せず状態遷移（SUPERSEDED/CORRECTED/EXPIRED/ARCHIVED）で履歴を保持する。
- PRESIDENT層・SENSITIVE_REFのRBACは `MemoryService.search` が強制する。検索を経由せず全件を返すAPIを追加しない。
- 汎用推論（`ai/generalReasoner.ts`）へ渡してよい社内事実はTool/Memory由来のみ。

### Live Integration（Phase B1）

- LLMフック（`ai/llmHooks.ts` の Curator v2 / Critic v2）は「提案・追加」のみ。保存可否はLearning Safety、検証の最終判定は決定論Critic（`reviewAnswerWithAdvisor`）が行う。この順序を逆にしない。
- サニティチェック（`sources/sanity.ts`、`npm run command:sanity`）がNOT READYの間、実データを会話へ提示しない。`config/sanity.expected.json` はソース側実件数の正本。
- Observability（`observability/observability.ts`）へ会話本文を保存しない（メタデータのみ）。フィードバックはモデルの自動学習に使わない。
- 実データの正本分類は `REAL_DATA_SOURCE_MAP.md` が正。LCC_CASE_DBはDERIVEDのため金額系エンジンの入力にしない。経営管理第13期の目標値はユーザー確認まで採用しない。People OS（給与）は複製禁止。
- 夜間メンテナンス（`npm run command:maintenance`）は既定DRY RUN。`LCC_MAINTENANCE_APPLY=true` なしで状態変更を保存しない。

### Live Beta準備（Phase B1.5）

- Sheets本番認証はService Account + `spreadsheets.readonly`（`sources/googleSheets.ts`）。API Keyを非公開業務シートの本番認証にしない。資格情報はenvのみ（Git・ログ・フロント露出禁止）。
- 経営目標はTarget Registry（`targets/targetRegistry.ts`）が正。コード直書き・Memoryのみでの保持を禁止。CANDIDATE→ユーザー承認→ACTIVE、変更はSUPERSEDEDで履歴保持。AIが独断でACTIVEにしない。
- 不足データはData Gap Registry（`domain/dataGaps.ts`）で管理。銀行・会計は推測で接続しない。予定配置（Schedule）を実績人工（DailyReport）として原価に使わない。日報は「日報データ（AI読み取り）」の確定行のみ実績候補。
- Visual Event Bus（`events/eventBus.ts`）へ機微情報・会話本文を流さない（Role/displayLabel/IDのみ。Provider名も非露出）。UI応答はGenerative UI Schema（`domain/uiSchema.ts`）を返し、AIに自由HTMLを生成させない。
- Real Evaluation（`evaluation/realEval.ts`）のHallucination Gateを壊さない: 存在しない実体への質問に正直な「確認できません」を返す挙動が完了条件。

### Multi-Agent層（src/command/agents/ — Phase N）

- Role（13種）は責務でありモデル名ではない。Role→Capability→Providerの3層を崩さない（`agents/roles.ts`）。
- Providerの動的選択は `agents/providerRegistry.ts`。機微データを渡せないProviderへのFallbackは拒否される（Data Policy）。この判定を迂回しない。
- 複数Role Planは外部調査要否・DEEP要求時のみ（Cost Guardrail）。通常会話を無闇にPlan化しない。
- Criticは答えを書き換えずissuesを返す。SYNTHESISの回答構造（結論→事実→分析→リスク→別案→推奨→次）を維持する。
- 内部Role名・Provider名をユーザー向け回答テキストへ露出しない。

### Phase VUI（docs/lcc-command-vui.html — Visual Intelligence UI）

- 粒子AI COREの視覚仕様の正本は `src/command/vui/visualSpec.ts`。UI側（HTML内のCORE_VISUALS）と同期させ、変更時は両方更新する（`tests/command/vui/` が検査）。
- 激しい点滅禁止（blinkHz≦2）。prefers-reduced-motionでは静的表示+状態ラベルで情報を保持する。
- 主画面へ内部Provider名（Claude/GPT等）を出さない（Detail Modeのみ）。UIはRole日本語ラベルで表示する。
- 未接続データは「未接続」「—」を明示し、架空金額を表示しない。API障害時は「データ取得できません」（デモ数値は ?demo=1 明示時のみ）。
- Approvalは承認/修正/却下UIを持つがdry-run固定。音声はプロバイダ未設定なら「準備中」と正直に表示し、偽の音声処理をしない。

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
