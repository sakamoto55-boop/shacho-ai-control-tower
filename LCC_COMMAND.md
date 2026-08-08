# LCC COMMAND — 会話型AI経営管制OS

マスタープロンプト v1.0 に基づく実装ドキュメント。

## 位置づけ

LCC COMMANDは「新しい正本」ではない。既存の正本（案件台帳・原価管理・請求台帳・銀行明細・営業接点）を横断して読み、

事実 → 計算 → 異常検知 → 分析 → 提案 → 経営判断 → 承認 → 実行 → 結果記録

の経営サイクルを一本につなぐ上位レイヤーである。既存の社長AI管制塔 Phase 1（メッセージ分析API）と同居し、`/command` 配下にマウントされる。

## 起動と試し方

```bash
npm install
npm run dev   # http://localhost:8787

# 会話（Orchestrator）
curl -X POST http://localhost:8787/command/chat \
  -H 'content-type: application/json' \
  -d '{"message":"今月どう？","scope":"lcc"}'

# 朝Brief / KPI / 資金繰り / アラート
curl 'http://localhost:8787/command/brief?scope=lcc'
curl 'http://localhost:8787/command/kpi?scope=group'
curl 'http://localhost:8787/command/cash/forecast?scope=lcc'
curl 'http://localhost:8787/command/alerts?scope=lcc'

# シナリオ分析（決定論的再計算）
curl -X POST http://localhost:8787/command/cash/scenario \
  -H 'content-type: application/json' \
  -d '{"scope":"lcc","adjustments":[{"kind":"delay_entry","planId":"cp-in-d","days":15}]}'

# 経営判断Memory（有効期間中は同種アラートを抑制）
curl -X POST http://localhost:8787/command/decisions \
  -H 'content-type: application/json' \
  -d '{"companyId":"lcc","projectId":"prj-a","decision":"A案件は粗利より完工を優先","reason":"顧客との完工約束を優先","decisionMaker":"社長","validUntil":"2026-08-20","suppressAlertKinds":["margin_drop"]}'

# 承認（Human-in-the-Loop。Phase Aは承認後もdry-run）
curl http://localhost:8787/command/approvals
curl -X POST http://localhost:8787/command/approvals/<id>/approve
```

UI（Mobile First・会話中心）: `docs/lcc-command.html`。
`?api=http://localhost:8787` でローカルAPIへ接続する。デモ表示は `?demo=1` を明示した場合のみで、
API障害時はデモ数値を出さずCONNECTION ERRORを表示する（GitHub Pagesでは `?demo=1` 付きで公開する）。

## アーキテクチャ

```
docs/lcc-command.html（Mobile First UI: 上=KPI / 中央=AI会話 / 下=入力）
  → POST /command/chat (src/command/server/routes.ts)
    → CommandOrchestrator (src/command/orchestrator/orchestrator.ts)
      → 意図判定（日本語ルール）→ Read Tool実行
        → 決定論エンジン (src/command/engines/)
           cashForecast / sales / margin / salesLeak / invoiceChecks / alerts / kpi
      → 事実と推測を分離した回答 + Evidence + Data Confidence + UiHint
    → Write系は tools/registry.ts 経由で ApprovalRequest（LEVEL 4+は承認必須）
  → CommandRepository (src/command/repositories/)
     読み取り正本: Phase Aはシード (src/command/data/seed.ts) が代替
     LCC COMMAND自身の正本: Decision / Task / Approval / Research をJSON永続化
```

### 最上位原則の実装対応

| 原則 | 実装 |
| --- | --- |
| AIに計算させない | `engines/` は全て決定論的な純関数。AIは説明のみ |
| 事実と推測を混ぜない | 回答は【確認できた事実】【主因】【AIの推測】【推奨】で分離 |
| 「分からない」を正しく返す | `DataConfidence`（HIGH/MEDIUM/LOW/UNKNOWN）。該当データなしは推測せずUNKNOWN |
| 根拠表示 | 全エンジンが `Evidence[]`（値・ソース・計算式・最終更新）を返す。UIに「根拠を見る」 |
| データ鮮度 | `Freshness`（lastUpdatedAt/source/stale）。銀行残高=前営業日は「最新ではありません」と明示 |
| 複数法人 | `CompanyScope`（group / 法人ID）。`filterDatasetByScope` を必ず通し混在させない |
| 経営判断Memory | `Decision`（valid_until付き）。有効期間中は同種アラートを抑制、期限後に再評価 |
| Human-in-the-Loop | Risk LEVEL 0–5（`approvalPolicy.ts`）。LEVEL 4+は `ApprovalRequest` 必須、Phase Aは承認後もdry-run |
| マルチエージェント乱立禁止 | Orchestrator 1つ + 明示的Tool群のみ。専門Agentは未起動 |
| Model Router | `ai/ModelRouter.ts`（purpose別ルート＋フォールバック）。Phase Aはmock |
| 音声 | `ai/VoiceProvider.ts` Adapter（OpenAI Realtime / Gemini Live差し替え前提）。失敗時もテキスト必須 |
| 外部Research | `request_research` → `ResearchTask`（queued/running/…）。社内事実と分離、出典URL保持の器あり |
| Proactive AI | Severity（INFO/WATCH/WARNING/CRITICAL）。CRITICALのみ即時、他は朝Briefへ集約 |
| 社長Brief | `brief/generateBrief.ts`。「昨日からの変化」「本日の判断事項」「AI推奨アクション」を優先 |

### 決定論エンジン

- **資金繰り（最優先）** `engines/cashForecast.ts` — 現預金＋入金予定−支払予定を日次積み上げ。7/30/60/90日予測、確定/予測の区別、最低残高、シナリオ分析（入金遅延・支出追加・入金追加・予定削除）。
- **売上・受注** `engines/sales.ts` — 当月確定売上、着地予測、目標比、受注残、見積提出済パイプライン（受注確度順）、来月見通し。
- **営業漏れ検知** `engines/salesLeak.ts` — 問い合わせ24h未対応 / 現調後見積未提出 / 見積後7日追客なし / 30日停滞 / 受注後次工程未設定。閾値は引数で変更可能。優先順位スコア付き。
- **粗利** `engines/margin.ts` — 予定/予測/実績粗利の分離。原価8カテゴリ（人工・外注・処分・材料・車両・重機・運搬・その他）。見積比の悪化主因を差額降順で特定。
- **請求・入金** `engines/invoiceChecks.ts` — 完工未請求 / 期日超過未入金 / 金額不一致。「請求漏れ0」KPIの母数を返す。
- **アラート集約** `engines/alerts.ts` — 上記をSeverity付きに変換し、Decision Memoryで抑制。
- **KPI** `engines/kpi.ts` — 現預金 / 30日後現金予測 / 当月売上 / 着地予測 / 受注残 / 全社予測粗利率 / 完工未請求額 / 営業要対応件数 / 重大アラート件数（全て鮮度・確信度付き）。

### データモデルとSource Adapter

`src/command/domain/types.ts`。Company / Customer / Project / Estimate / Interaction / Cost / Invoice / Payment / CashAccount / CashPlanEntry / Decision / Task / Approval / ResearchTask / Alert ほか。既存IDは `externalIds`（Mapping Layer）に保持し振り直さない。

`src/command/sources/SourceAdapter.ts` が Canonical Model と取得元を分離する。Source（CashSource / AccountingSource / ProjectSource / EstimateSource / CostSource / InvoiceSource / PaymentSource / DailyReportSource / ScheduleSource / CustomerSource / InteractionSource / DocumentSource）ごとに `sourceType / lastSuccessfulSync / freshness / confidence / readOnly / scope / errorState` を持ち、`GET /command/sources` で状態を確認できる。

### モードとDemo Fixture隔離（最重要）

- `LCC_COMMAND_MODE=demo | production`（既定 demo）。データセットは `meta.mode` を必ず持つ。
- **productionでソース未接続/取得失敗時はデモデータへ決してフォールバックしない。** `/kpi` は `dataStatus: DATA_UNAVAILABLE`＋空KPI、`/chat` は「DATA UNAVAILABLE / CONNECTION ERROR」回答、`/brief` `/cash/*` は503。
- UIのデモ表示は `?demo=1` の明示時のみ。API障害時は CONNECTION ERROR を表示しデモ数値を出さない。
- 隔離はテストで自動検証する（`tests/command/gate/failure-demo-isolation.test.ts`）。

### 認証・RBAC（`src/command/domain/rbac.ts`）

ロール: PRESIDENT / EXECUTIVE / MANAGER / STAFF / SYSTEM。グループ横断・法人横断はPRESIDENT/SYSTEMのみ。制御はUIでなくAPI＋Orchestrator（Tool実行前）の両方で強制する。Phase Aの認証は `LCC_COMMAND_API_TOKENS`（token→role/companyIds）で、productionモードではトークン必須（フェイルクローズ）。Phase BでGoogle Identityへ置換する（認可判定はrbac.tsに残る）。

- 承認の実行（approve/reject）: PRESIDENT / EXECUTIVE のみ。Idempotent（二重承認は再実行されない）。
- Decision登録: PRESIDENT / EXECUTIVE のみ。`reason` `decisionMaker` `validUntil`（未来日・180日以内）必須。AIは登録できない。

### セキュリティ（`src/command/security/`）

Tool引数Validation / Prompt Injection検知（外部文書・入力内の命令をSystem Instruction化しない）/ Rate Limit / Audit Log（機微情報マスク付き）/ Secretスキャン（テストで自動検査）。

### 会話コンテキストと複合質問

`orchestrator/context.ts` がセッション別に直前の話題・対象案件・提示リスト・下書き・根拠を保持し（TTL30分）、「それ」「さっきの」「2番目」「もっと詳しく」「逆に」「根拠は？」「本当に？」「他にない？」「グループ全体では？」を解決する。複数ドメインにまたがる質問はPlanner（`tryCompound`）が分解して複数Toolを実行・統合する。`ORCHESTRATOR_LIMITS`（maxSteps=6 / maxToolCalls=10 / timeout=5s）で無制限ループを禁止する。

### 日付・時刻

システム標準TimezoneはAsia/Tokyo。内部保持はISO(UTC)のまま、「今日」「当月」等の判定は `utils/jst.ts` で必ずJST変換する（月跨ぎ・年度跨ぎはテスト済み）。支払日の休日調整（前営業日/翌営業日）は `computeCashForecast` のオプション。祝日リストはPhase Bでカレンダーソースから供給する。

## 接続前提の分類（Phase A Gate Review §1）

現時点のシステム接続前提。**UNKNOWNはヒアリング確認まで確定しない。**

| 分類 | 対象 | 扱い |
| --- | --- | --- |
| CURRENT | Google Workspace（Gmail/Drive/Calendar）、Google Sheets + GAS（主要構造化データ基盤）、デジタル配置板系（配置・日報）、統合業務システム（見積・原価。`docs/lcc.html` 系）、LINE WORKS / Form（入力チャネル） | Phase BのSource Adapter実装対象 |
| LEGACY | `src/repositories/KintoneRepository.ts`、`src/connectors/kintone.ts`、READMEのkintone節 | Phase 1時代のスタブ。LCC COMMANDからは参照しない。削除はPhase 1系の整理時に判断 |
| UNKNOWN | 会計・給与の実サービスと接続方式、銀行明細の取得方法（API/明細CSV/手動）、配置板・統合業務システムのAPI可否 | 実運用を確認してから接続方式を決める。コード上は `SourceAdapter` の `not_configured` + `errorState: UNKNOWN` として明示 |

LCC COMMANDのコード・シードからkintone前提の記述は除去済み（Mapping Layerのキーは `estimateSystem` 等の中立名）。

## Phase B0（実データ発見・READ ONLY接続）の状態

- **Source Adapter実装済み**: `sources/googleSheets.ts`（Sheets API v4 values.get のみ＝READ ONLY、
  timeout/retry/schema validation/freshness/provenance/errorState）。列マッピングは `LCC_SHEETS_SOURCES` で
  設定し、`sources/canonicalMapping.ts` が日本語シート→Canonical Modelへ変換（既存IDは `prj:`/`cust:` +
  `externalIds.sheet` のCrosswalkで保持、振り直さない）。
- **配置と日報の分離**: `ScheduleAssignment`（予定配置）と `DailyReportEntry`（実績・人工）を別モデルで保持。
  「今日の現場は？」は予定として、「昨日誰がどこ？」は実績日報で回答し、予定を実績人工として扱わない。
- **データ品質検査**: `domain/dataQuality.ts` + `GET /command/data-quality`（検出のみ・自動修正なし）。
- **Google Identity認証**: `auth/googleIdentity.ts`。IDトークン検証（audience/期限/メール検証）→
  email→LCC User→Role/Scope。認可（RBAC）は不変。`LCC_GOOGLE_AUDIENCE` + `LCC_COMMAND_USERS` で有効化。
- **正本調査**: `REAL_DATA_SOURCE_MAP.md` 参照。Drive読み取りツールの承認待ちのため全候補UNKNOWN維持。
- **スナップショット経路**: `SnapshotSheetsClient`（`data/snapshots/`、Git管理外）でクレデンシャルなしの実データ検証が可能。

## Phase M（Persistent Intelligence / 会話学習・Innovation Engine）の状態

Phase A/B0の決定論エンジン・Canonical Model・Source Adapter・RBAC・Evidenceを変更せず、上位に「継続学習する会社知能層」を追加した。学習＝Fine-tuningではなく、会話→抽出→検証→永続Memory→将来の想起→実験→結果→Lessonのループ。

- **Persistent Memory** `src/command/memory/`（12種のAtomic Memory型、ACTIVE/SUPERSEDED/CORRECTED/EXPIRED/REJECTED/ARCHIVEDの状態遷移、validFrom/validUntilのTemporal Memory、出典・確信度・Entity/Relation付き）。COMPANY/PRESIDENT/OPERATIONAL/EXTERNALの層分離とRBAC（PRESIDENT層は経営者のみ）。
- **Learning Safety（store側で強制）**: AI推測のFACT保存禁止／AIによるDECISION独断確定禁止（PENDING_REVIEW必須）／出典なし重要Memory禁止／給与等の実値複製禁止（SENSITIVE_REFは参照のみ）／外部調査はEXTERNAL層へ強制／履歴なし上書き禁止／物理削除なし。
- **Memory Curator**: 会話から意見→HYPOTHESIS(UNVERIFIED)、決定宣言→DECISION候補（確認待ち）、問題・好み・約束を自動抽出。重複はEvidence追記、矛盾はConflictとして両方保持し報告（ユーザー判断で解決）。
- **会話能力**: 「前に◯◯何だっけ？」（Cross-session想起）「2025年当時は？」（時間軸）「それどこから？」（Provenance）「それ、今も正しい？」（Decision Review）「それ違う。今は◯◯」（訂正・履歴保持）「何を覚えている？」（Memory Audit）。
- **Universal Router + General Fallback**: 12カテゴリ多重分類。固定Intent外はUNKNOWN終了せず汎用推論へ。`ANTHROPIC_API_KEY` 設定時はAnthropicモデル（社内事実はTool/Memory由来のみ注入・捏造禁止プロンプト）、未設定時は「できない」と正直に返す。
- **Innovation Engine**: 問題定義→データによる現状→Root Cause候補→社内類似事例(Memory)→前提を疑う→Conservative/Practical/Innovative 3案（実現性・ROI観点・Risk・最小テスト付き）。簡潔指定時は要約のみ。
- **Experiment Engine + Result Feedback**: 仮説→実験（指標・Baseline・Target）→結果→Lesson化して会社Memoryへ還元。結果未登録はメンテナンスが検出。
- **Nightly Maintenance** `GET /command/memory/maintenance`: 期限切れDECISIONのEXPIRED遷移（機械的ルールのみ自動）、未検証仮説・確認待ち・重複・矛盾・Archive候補の報告、Proactive Problem Discovery（複数案件に共通する原価超過パターン等）。
- **API**: `GET /command/memory`（検索・時間軸・RBAC）、`POST /command/memory/:id/confirm|archive`、`POST /command/memory/conflicts/resolve`、`GET/POST /command/experiments`、`POST /command/experiments/:id/result`。

## Phase N（Multi-Agent Role Orchestration / Critic / Adaptive Intelligence）の状態

- **Role抽象化（§1）**: `agents/roles.ts`。13 Role（STRATEGY〜SYNTHESIS）を責務として定義し、
  Role→Required Capability→Provider/Model/Toolの3層。モデル名を業務Roleにしない。
- **Provider Registry（§6-8）**: `agents/providerRegistry.ts`。Capability/Cost/Latency/Reliability/
  実績成功率でスコアリングして動的選択。未設定Providerでも全体停止しない。障害時はFallbackするが、
  Data Policy（機微データ）を満たせない切替は拒否して説明する。ManusはRoleでなくProvider候補（§39）。
- **Role Router / Task Plan（§3-5）**: `agents/rolePlanner.ts`。入力をIntent/Complexity/Risk/
  内外データ要否/推論深度/機密/緊急度で評価し、必要な場合のみ複数RoleのPlan
  （並列: ANALYSIS・MEMORY・RESEARCH → STRATEGY/FINANCE → CRITIC → SYNTHESIS）を構成。
  LLM同士の自由議論は禁止（構造化Task結果のみ）。Budget: LOW/NORMAL/DEEP（「徹底的に」で昇格・§34-35）。
- **Critic（§9-11）**: `agents/critic.ts`。高リスク・検証要求・矛盾・複数Agent結論でのみ起動。
  根拠なし数値・推測混在・Decision矛盾・リスク/別案欠落をissues[]で返し、答えは書き換えない。
  Devil's Advocate（「別の見方は？」「反対意見は？」）対応。
- **Synthesis（§12-13）**: 【結論】→【確認できた事実】→【分析】→【リスク】→【別案】→【推奨】→
  【次にやること】へ統合。Preference Memory/「簡潔に」で圧縮。内部Role名・Provider名は非露出（§30）。
- **Correction Impact（§14-17）**: `agents/correctionImpact.ts`。訂正時にEntity起点で影響案件・見積・
  指標・関連記憶を探索し報告（数値は書き換えない）。単価変更等はActive Clarification構造
  （確認できたこと/不明/なぜ重要/選択肢/推奨）で「正式決定ですか？」と確認質問する。
- **Innovation v2（§18-21）**: 15アプローチ軸、First Principlesモード、制約のREAL/POLICY/HABIT/
  ASSUMPTION分類（法令は無視しない）、他業界アナロジー（一般知識と明示）、「もっと大胆に」で10倍案。
- **Insight Ranking / 問いの提案（§22-24）**: Impact/Urgency/Confidence/Actionabilityで採点し
  低価値Insightは出さない。Strategic Question（比較しますか？）は提案のみでDecisionを変更しない。
- **Playbook / Principle（§26-28）**: 複数LESSONの共通パターン→PLAYBOOK候補、確定Decisionの一貫
  傾向→PRINCIPLE候補。いずれもPENDING_REVIEWで、AIは自動的に正式ルール化できない（store側で強制）。
- **Observability（§33）**: AgentTraceLog（Plan/Role/Provider/latency/成否/Fallback/根拠数）。
  Plan応答の`data.trace`に添付。
- **会話（§41）**: 「それ覚えておいて」「いや、今のなし」「さっきのを正式方針にする」
  「それで影響するところある？」「もっと大胆に」「その案のリスクは？」「間違いない？」等の連続会話が成立。
- **Evaluation（§40）**: 100問データセット（17カテゴリ、`tests/command/nphase/evaluation.test.ts`）。
  Synthetic Fixture評価。B0完了後に実データ評価へ置換する。

## Phase B1（Live Integration: 実データ発見完了 + LLMフック + 本番会話準備）の状態

- **実データ発見完了（§1-2）**: B0でブロックされていたDrive READ ONLYアクセスが解除され、5候補全ての
  実測を完了。分類は `REAL_DATA_SOURCE_MAP.md`（統合業務システムDB=CURRENT_SOURCE 顧客2,268/案件2,459、
  配置板DB=マスタ正本・運用タブ空、LCC_CASE_DB=DERIVED、経営管理第13期=REFERENCE_ONLY仮値、
  People OS v17=高機密・複製禁止）。実測の品質課題は `DATA_QUALITY_REPORT.md`。
- **列マッピング定義（§3）**: `config/sheets.sources.example.json`（customers/projectsの実測スキーマ→Canonical、
  status英語コードのstageMap込み）。全量同期は `spreadsheets.readonly` 資格情報の設定待ち（ユーザー作業）。
- **サニティチェック（§4）**: `sources/sanity.ts` + `npm run command:sanity`。ソース実件数
  （`config/sanity.expected.json`）とCanonical件数の乖離が5%を超える間はNOT READY＝実データを会話へ出さない。
- **LLM Curator v2（§7）**: `ai/llmHooks.ts` + `memory/curator.ts` の `LlmCandidateExtractor`。
  LLMは候補提案のみ。FACTはHYPOTHESIS+UNVERIFIEDへ格下げ、DECISION/PLAYBOOK/PRINCIPLEはPENDING_REVIEW固定、
  保存可否は既存Learning Safetyが最終判定。`ANTHROPIC_API_KEY` 未設定時は従来のルール抽出のみ。
- **Critic v2（§8）**: `agents/critic.ts` の `reviewAnswerWithAdvisor`。LLM指摘は「追加」だけ可能で、
  決定論検査の指摘を削除・上書きできない。LLM障害時は決定論結果のみ返す。
- **学習の可視化（§13-14）**: 「今日何を覚えた？」→Daily Learning Summary（覚えた/確認待ち/訂正の内訳）。
  朝Briefに【今日AIが学んだこと】と【AIの気づき（上位のみ）】（Insight Rankingの上位2件まで）を掲載。
- **夜間メンテナンス（§15）**: `npm run command:maintenance`（既定DRY RUN。適用は `LCC_MAINTENANCE_APPLY=true`）。
- **Observability / Cost（§19-20）**: `observability/observability.ts`。会話メタデータ（intent・Tool・確信度・
  所要時間）のみ記録し会話本文は保存しない。JSONL永続化は `LCC_COMMAND_OBS_FILE`。`GET /command/observability`。
- **回答フィードバック（§21）**: `POST /command/feedback`（good/bad）。改善の参考として保存するのみで、
  モデルの自動学習には使わない。UIの各AI回答に👍/👎、フッターにMemory Feedbackチップ
  （覚えて/訂正/重要/仮説/正式決定/忘れて→既存の会話ハンドラへそのまま接続）。
- **銀行・会計（§18）**: 実測でも該当ソース未特定のためUNKNOWN維持。資金繰り回答は
  「銀行残高未接続のため完全な資金予測ではない」旨を明示し続ける。

## Phase B1.5（Live Beta Activation Preparation）の状態

- **Sheets認証（§1）**: 本番標準はService Account + `spreadsheets.readonly`（`sources/googleSheets.ts` の
  `ServiceAccountTokenProvider`。RS256 JWT自前署名・トークンキャッシュ・スコープ固定）。対象シートのみ
  閲覧者共有の最小権限方式。API Keyは非公開業務シートの本番認証に使わない。設定は
  `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICE_ACCOUNT_FILE`（envのみ・Git/ログ露出禁止）。
- **配置・日報の再調査完了（§5-§7）**: 実運用は物理ホワイトボード→毎日写真→AI読み取りで
  「日報データ（AI読み取り）」シート（`19nu2Kzpr…`）へドラフト起票（工数・AI信頼度・確認ステータス・確定列）。
  配置板DBの運用タブが空の原因は「デジタル配置板構築済み・未稼働」。詳細は `REAL_DATA_SOURCE_MAP.md` §6。
  確定（✔）行のみを実績として扱い、予定配置を実績人工に使わない（§8）。未確定の間は LABOR_ACTUAL = UNKNOWN。
- **Data Gap Registry（§9-§10）**: `domain/dataGaps.ts` + `GET /command/data-gaps`。DG-001（日報正本）〜
  DG-007（目標未承認）をEvidence・capabilityImpact付きで管理。銀行・会計はUNKNOWNのまま登録
  （Current Cash Confidence = UNKNOWN → 30/60/90予測 = INCOMPLETE を明示）。
- **Target Registry（§11-§15）**: `targets/targetRegistry.ts` + `GET/POST /command/targets` +
  `POST /command/targets/:id/approve`。目標のコード直書き禁止。発見値はCANDIDATEのみ、
  ACTIVE化はPRESIDENT/EXECUTIVEの承認のみ。同一metric×期間の旧TargetはSUPERSEDEDで履歴保持。
  数値の正はRegistry、Memory側には承認Decision（CONFIRMED_BY_USER）を残す。
- **Capability Matrix（§16-§17）**: `domain/capability.ts` + `GET /command/capabilities` + `CAPABILITY_MATRIX.md`。
  ANSWERABLE/PARTIAL/NOT_ANSWERABLEをデータ実態から判定し、不足データと接続後にできることを明示する。
- **Provider Configuration（§3-§4）**: `agents/providerRegistry.ts` の `describe()`。API Key未設定は
  NOT_CONFIGUREDの正常状態（全体をエラーにしない）。health（successRate/lastSuccess/lastFailure）付き。
  AnthropicはProvider Registry上の最初の実Providerであり、Role→Capability→Providerの3層は不変。
- **Visual Event Bus / AI CORE（§18-§21・§28）**: `events/eventBus.ts`（22イベント型・リングバッファ・subscribe）
  + `GET /command/events` / `GET /command/core-state`。AgentTraceからROLE_STARTED/COMPLETEDを発行し、
  UIにはRole（displayLabel日本語）のみ露出（Provider名・機微情報・本文はEventへ流さない）。
  AI CORE状態（IDLE〜ERROR、primaryState + activeRoles[]）を導出。
- **Generative UI Schema（§23-§25）**: `domain/uiSchema.ts`。17コンポーネント型 + Suggested Actions
  （根拠を見る/反対意見/類似事例/覚えて/訂正…を文脈で動的生成）。`POST /command/chat` 応答へ `ui` を追加
  （既存フィールドは互換維持）。AIの自由HTML生成はしない。
- **Real Evaluation Harness（§29-§30）**: `evaluation/realEval.ts` + `npm run command:real-eval`。
  Synthetic評価と分離し、answerable/correct/evidencePresent/freshness/confidence/hallucination/latencyを記録。
  Hallucination Gate（存在しない案件・顧客・金額・Decisionを質問→「確認できません」を返すこと）は
  デモFixture上でも常時テストされる（`tests/command/b1/phaseB15.test.ts`）。
- **Beta Gate（§31-§32）**: Service Account接続・全量Sanity PASS・実LLM 1つ以上・100問Real Evaluationが
  未達のため、LIVE READ-ONLY BETA READYは未宣言。ただし配置/日報・銀行/会計の未接続はBeta阻害条件にしない
  （該当CapabilityのみPARTIAL/NOT_AVAILABLE明示で段階開放）。

## Phase VUI（Visual Intelligence Interface）の状態

- **UI本体**: `docs/lcc-command-vui.html`（単一HTML・Vue3+Tailwind CDN・ビルド不要）。
  Dark/Premium/Executive Command Centerの方向（§40 Visual Reference準拠）。
- **粒子AI CORE（§2-§3）**: Canvas 2Dパーティクルシステム（§28比較の結果、Three.js等の
  巨大依存なし＝Mobile/バッテリー/バンドル/保守性最良を採用）。13状態すべてに視覚挙動
  （drift/converge/radiate/orbit/stream/link/tighten/reform/hold/pulse/alert/calm-error）。
  激しい点滅なし（blinkHz≦1）。正本仕様は `src/command/vui/visualSpec.ts`（テストで検証）。
- **Event Bus購読（§3-§4）**: 会話ごとに `/command/events` を購読し、ROLE_STARTED等から
  Role Ring（戦略/資金/営業/現場/分析/調査/記憶/検証/創発/統合）の発光とCORE状態遷移を再生。
  活動中Roleのみ反応。内部Provider名は主画面へ出さない（§5。Detail Modeでのみ「使用Provider」）。
- **Conversation First（§8-§10）**: チャット主役・Streaming表示（RESPONDING状態と同期）・
  Morning Experience（§35。データ未取得時は件数を捏造しない挨拶）。
- **Generative UI（§11-§12）**: UI Schema 17型すべてのRenderer（KPI/RANKING/CASH_FLOW/
  APPROVAL/ALERT/PROJECT_CARD…）。AIの自由HTMLは描画しない。会話に応じて画面が変わる。
- **Evidence/Confidence/Freshness（§13-§15）**: 「根拠を見る」展開（Source/Record/更新日）、
  確信度はHIGH以外のみバッジ表示、KPIに更新時刻とstale警告。古いデータを最新に見せない。
- **Memory/Correction/Critic/Innovation/Approval UX（§16-§22）**: 記憶Role反応・
  Contextual Suggested Actions（覚えて/訂正/反対意見/類似事例…を文脈で動的表示）・
  Approval Cardは承認/修正/却下（dry-run固定。本番実行なし）。
- **Mobile First（§23-§27）**: CORE高さ25-35%（スクロールで縮小）・横スクロールなし・
  マイクボタンは「音声機能は準備中（プロバイダ未設定）」と正直表示（偽の音声処理なし）。
- **Reduced Motion / Performance / A11y（§29-§31）**: prefers-reduced-motionで静的CORE
  （状態はラベルで保持）・Particle数の端末別自動削減・非表示タブで描画停止・aria-live/
  aria-label/キーボード操作/focus-visible。
- **Executive/Detail Mode（§32-§34）**: 通常は情報を絞り、詳細（AgentTrace/Tool/Provider/
  Latency）は展開時のみ。AI COREタップで稼働中の能力を自然な日本語で表示。
- **Unknown State / Demo Isolation（§36-§37・§41）**: 銀行未接続=「未接続」、配置=
  「実績日報との案件紐付け準備中」を明示。API障害時は「データ取得できません」でデモ数値非表示。
- **検証**: `tests/command/vui/`（visualSpec全状態・UI完成条件・§44会話シーケンス）+
  Chromium実機レンダリング確認（Desktop/Mobile/reduced-motion/ライブ会話でRole発光・
  Generative UI・Streaming・Approval動作をスクリーンショット確認済み）。

## Phase X（Company Constitution / Future Intelligence / Universal Capability OS）の状態

- **Company Constitution Layer（§2-§8）**: `constitution/constitutionRegistry.ts` + `GET /command/constitution`。
  第13期系列9ファイルをREAD ONLY比較（`CONSTITUTION_SOURCES.md`）し、v7社長用（系列最新）等から
  9原則を抽出。**すべてCANDIDATE**（AI判断でCURRENTにしない）。承認はPRESIDENTのみ、変更は
  SUPERSEDED+新CANDIDATE（履歴保持）。`checkProposal()` が「正本は1つ」等に反する提案へ警告（§7・§46）。
- **Data Stewardship（§9）**: `domain/stewardship.ts` + `GET /command/stewardship`。8つの重要Sourceに
  Owner・部門・更新頻度・品質責任をEvidence付きで定義（経営の聖書v7の運用記載に基づく）。
- **Future Intelligence Engine（§10-§14）**: `future/futureEngine.ts` + `GET /command/future`。
  受注残の月数・資金・粗利傾向・キャパシティ・パイプラインを決定論評価。未接続領域（銀行・日報）は
  推測補完せずUNKNOWN/INCOMPLETE明示。Scenario Planning（売上±%・退職・投資・現状継続）は
  確定計算+仮定明示。AIからの問い提案（§14）は提案のみで行動しない。
- **Universal Capability Registry（§15-§18・§39-§41）**: `capabilities/capabilityRegistry.ts` +
  `GET /command/ai-capabilities`。45能力（検索/分析/読解/生成/Artifact作成/Build/見積8能力/音声/実行）を
  §16の全属性付きで正本管理。Provider未接続はNOT_CONFIGUREDの正常状態。Capability Routerが
  依頼→能力連鎖・Execution Budget（LOW/NORMAL/DEEP/BUILD）・権限（給与→PRESIDENT、公開/Deploy→承認）を決定。
- **Artifact Registry / Creation（§19-§22・§35-§36）**: `artifacts/artifactRegistry.ts` + `GET /command/artifacts`。
  「プレゼン作って」等はCapability連鎖Plan（SEARCH_INTERNAL→…→CRITIC）になり、生成Provider未接続時は
  正直に伝えてPLANNEDとして登録（偽の完成品を返さない）。supersedeで版履歴を保持。
- **Software Build（§23-§24）**: `build/softwareBuild.ts`。既存システムカタログ7件との重複チェックを
  必ず先行し、新規/既存改修/統合を比較提示。「作れるから作る」を構造的に禁止。Constitution照合込み。
  本番Deployは承認なしで行わない。
- **見積Capability（§25-§26）**: `estimate/estimateCapability.ts`。顧客→工種→類似案件→受注額中央値→
  粗利参考→不足情報の草案生成。金額はすべて決定論（AIが暗算しない）。
- **Internal Search Super Layer（§27-§30）**: `search/unifiedSearch.ts` + `GET /command/search?q=`。
  正本カタログ（実測7ソース）+顧客・案件+Memoryを統一Schemaで検索。「第13期経営計画書どれ？」に
  正本判定付きで回答。People OSはPRESIDENT権限のみ。見つからない場所は推測しない。
- **UI Schema拡張（§35・§48）**: FUTURE_INSIGHT / ARTIFACT_PREVIEW / SEARCH_RESULTS / CONSTITUTION を追加。
- **Evaluation（§52）**: `tests/command/xphase/`（Constitution/Future/Scenario/Capability Routing/
  Permission/Artifact/Build重複チェック/見積/統合検索/Stewardship/API）。

## Phase LIVE-AI（Constitution Activation / Real Provider / Universal Creation）の状態

- **Constitution完成準備（§1-§5）**: 印刷版経営計画書（3校）PDF本文を読解し、Vision/Mission/Values/
  経営理念/社訓/安全/品質/クレーム/営業価格/財務/DX/長期目標を原文抽出（const-010〜020、計20原則・
  全CANDIDATE）。不動産課15.0はv7+PDFの2源一致で**RECOMMENDED_CANDIDATE**。社長の承認事項は
  `CONSTITUTION_REVIEW.md` の**10項目**に集約（数十問ヒアリングなし）。
- **実Provider Adapter（§6-§11）**: `ai/liveProviders.ts` — OpenAI（chat completions）/ Gemini
  （generateContent）/ Manus（非同期Task）/ OpenAI Images。Anthropic含め4系列がKey設定のみで有効化。
  Role→Capability→Provider構造は不変。「Claudeで」「Geminiでも」等の上級Provider指定に対応（§38。通常Auto）。
- **Provider Benchmark（§12）**: `evaluation/providerBenchmark.ts` + `npm run command:benchmark`
  （Quality/Latency/Structured成功率/正確性を記録。将来のRouter選択に使用）。
- **Universal Search強化（§13-§14）**: Artifact Registryを検索対象に追加（「前に作った○○どれ？」）。
  検索結果に必ずEvidenceを返す。
- **Creation実装（§15-§22）**: 決定論Renderer（`artifacts/renderers.ts`: pptxgenjs/exceljs/docx/pdfkit +
  自前SVG Chart/Diagram）により **PPTX/XLSX/DOCX/PDF/図をLLM Keyなしでも実ファイル生成**。
  内容は`contentBuilders.ts`（経営会議デッキ・見積Workbook・経営報告書 — 全数値決定論エンジン由来）。
  「経営会議のプレゼン作って」→実PPTX生成→Artifact Registry（COMPLETED・出典付き）→VUI進捗イベント。
  画像生成はOPENAI_API_KEY設定時のみ（未設定は正直にPLANNED・§46）。
- **見積→文書（§23-§24）**: 見積草案→`buildEstimateWorkbookSpec`でExcel化（数式・検証・複数シート）。
  金額・粗利は決定論のみ。ユーザー承認なしで正式見積化しない。
- **Software Engineering Bridge（§25-§28）**: `build/codingAgentBridge.ts` — CodingAgentAdapter抽象
  （特定Agentへハードコードしない）+ BuildTaskライフサイクル（PLANNING〜COMPLETED）。
  **WAITING_APPROVAL→COMPLETEDは人間承認必須**（自動Deploy禁止をコードで強制）。
- **Artifact Intelligence（§29-§31）**: 目的・Evidence・Source・Version・Outcome KPIを保持。
  `POST /command/artifacts/:id/outcome` で効果を記録→LESSONとしてMemoryへ還元。
- **Future→Innovation連鎖（§32-§33）**: Future RiskをlastProposalへ渡し「対策考えて」「もっと大胆に」で
  Innovation Engineへ接続。
- **最小起動セット（§43）**: Sheets Service Account + 実LLM Provider1つでLIVE READ ONLY BETA起動可能。

## フェーズ計画

- **Phase A（本実装）**: 会話コア＋決定論エンジン＋承認フロー＋Brief＋UI＋RBAC/セキュリティ。読み取り正本はDemo Fixture（demoモード限定）。実行は全てdry-run。
- **Phase B（実データ接続）**: `SourceRegistry` へ Google Sheets / GAS / 統合業務システム / 配置板 / LINE WORKS のSource Adapterを実装して差し込む（エンジン・Orchestratorは無変更）。認証をGoogle Identityへ置換。音声Provider実装。承認済みLEVEL 3（社内通知）の実行。会計・給与・銀行はヒアリング確定後に接続。
- **Phase C（実行・拡張）**: 承認済みLEVEL 4の実実行（外部送信）、Manus等の外部Research実接続（Webhook検証込み）、Generative UIの拡充、Proactive通知（CRITICAL即時プッシュ）。

## 変わらない制約（Phase 1と共通）

- AIによる外部自動返信は作らない。送信は承認必須で、承認後もPhase A/Bはdry-run。
- 金額・契約・納期・謝罪・責任認定・人事は自動確定しない（LEVEL 5=強い承認）。
- 個人LINEの直接連携は作らない（`external_forward` 転記のみ）。
- AIが生成した数字を根拠として扱わない。
