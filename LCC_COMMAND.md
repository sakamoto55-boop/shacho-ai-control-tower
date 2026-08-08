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

## フェーズ計画

- **Phase A（本実装）**: 会話コア＋決定論エンジン＋承認フロー＋Brief＋UI＋RBAC/セキュリティ。読み取り正本はDemo Fixture（demoモード限定）。実行は全てdry-run。
- **Phase B（実データ接続）**: `SourceRegistry` へ Google Sheets / GAS / 統合業務システム / 配置板 / LINE WORKS のSource Adapterを実装して差し込む（エンジン・Orchestratorは無変更）。認証をGoogle Identityへ置換。音声Provider実装。承認済みLEVEL 3（社内通知）の実行。会計・給与・銀行はヒアリング確定後に接続。
- **Phase C（実行・拡張）**: 承認済みLEVEL 4の実実行（外部送信）、Manus等の外部Research実接続（Webhook検証込み）、Generative UIの拡充、Proactive通知（CRITICAL即時プッシュ）。

## 変わらない制約（Phase 1と共通）

- AIによる外部自動返信は作らない。送信は承認必須で、承認後もPhase A/Bはdry-run。
- 金額・契約・納期・謝罪・責任認定・人事は自動確定しない（LEVEL 5=強い承認）。
- 個人LINEの直接連携は作らない（`external_forward` 転記のみ）。
- AIが生成した数字を根拠として扱わない。
