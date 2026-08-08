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
  -d '{"companyId":"lcc","projectId":"prj-a","decision":"A案件は粗利より完工を優先","validUntil":"2026-08-20","suppressAlertKinds":["margin_drop"]}'

# 承認（Human-in-the-Loop。Phase Aは承認後もdry-run）
curl http://localhost:8787/command/approvals
curl -X POST http://localhost:8787/command/approvals/<id>/approve
```

UI（Mobile First・会話中心）: `docs/lcc-command.html`。
`?api=http://localhost:8787` を付けるとローカルAPIへ接続し、接続できない場合は
シードデータと同じ数値のデモモードで動作する（GitHub Pages公開可）。

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

### データモデル

`src/command/domain/types.ts`。Company / Customer / Project / Estimate / Interaction / Cost / Invoice / Payment / CashAccount / CashPlanEntry / Decision / Task / Approval / ResearchTask / Alert ほか。既存IDは `externalIds`（Mapping Layer）に保持し振り直さない。

## フェーズ計画

- **Phase A（本実装）**: 会話コア＋決定論エンジン＋承認フロー＋Brief＋UI。読み取り正本はシードデータが代替。実行は全てdry-run。
- **Phase B（実データ接続）**: 既存正本へのRead接続（kintone案件台帳・原価管理・会計/銀行明細・Gmail/LINE WORKSの営業接点化）。`CommandRepository.getDataset` の実装差し替えのみで移行できる設計。音声Provider実装。承認済みLEVEL 3（社内通知）の実行。
- **Phase C（実行・拡張）**: 承認済みLEVEL 4の実実行（外部送信）、Manus等の外部Research実接続（Webhook検証込み）、Generative UIの拡充、Proactive通知（CRITICAL即時プッシュ）。

## 変わらない制約（Phase 1と共通）

- AIによる外部自動返信は作らない。送信は承認必須で、承認後もPhase A/Bはdry-run。
- 金額・契約・納期・謝罪・責任認定・人事は自動確定しない（LEVEL 5=強い承認）。
- 個人LINEの直接連携は作らない（`external_forward` 転記のみ）。
- AIが生成した数字を根拠として扱わない。
