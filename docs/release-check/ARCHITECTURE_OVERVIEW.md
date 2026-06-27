# ARCHITECTURE_OVERVIEW.md — AI社長室 アーキテクチャ概要

> 最終更新: Phase 10 — v1.0.0（2026-06-27）

---

## Phase 10 AI Engine追加（v1.0.0 確定）

### 追加エンジン（6本）

| エンジン | ファイル | 役割 |
|---------|---------|------|
| CrossProviderContext | `crossProviderContext.ts` | 全Provider横断コンテキスト / テーマ別クラスタリング |
| CompanyHealthEngine | `companyHealthEngine.ts` | 会社健康スコア（9カテゴリ / グレードA〜D）|
| DecisionEngine | `decisionEngine.ts` | 社長の今日の優先判断リスト TOP7 |
| ActionDraftEngine | `actionDraftEngine.ts` | 社長承認用下書き（`externalSendDisabled: true`）|
| ExecutiveBriefing | `executiveBriefing.ts` | 朝ブリーフィングテキスト生成 |
| AI Orchestrator | `aiOrchestrator.ts` | 全統合 `runOrchestrator()` → `OrchestratorResult` |

### Provider接続状況テーブル（Phase 10 更新）

| Provider | 接続状態 | データソース | 次フェーズ |
|---------|---------|------------|---------|
| Inbox Provider | デモ接続 | Gmail（13件）+ LINE WORKS受信箱（4件）| — |
| Schedule Provider | デモ接続 | Google Calendar（デモ）| 本番OAuth（Phase 11）|
| File Provider | デモ接続 | Google Drive（デモ）| 本番OAuth（Phase 11）|
| BusinessData Provider | デモ接続 | Google Sheets（デモ）| freee / TKC（将来）|
| Notification Provider | デモ接続 | LINE WORKS通知（5件）| 本番OAuth（Phase 11）|

---

## 設計原則

AI社長室は**Googleサービス単位ではなく、社長の判断領域（Provider）単位**で設計します。

| ❌ 悪い例（サービス単位） | ✅ 良い例（Provider単位） |
|----------------------|----------------------|
| Gmail画面            | Inbox Provider（メール・LINE WORKS・通知） |
| Googleカレンダー画面  | Schedule Provider（予定・会議・期限） |
| Driveファイル画面     | File Provider（契約書・案件資料・報告書） |
| スプレッドシート画面   | BusinessData Provider（売上・粗利・資金繰り） |

---

## レイヤー構成

```
──────────────────────────────────────────────────────────────────
Layer 1: 外部サービス（データソース）
──────────────────────────────────────────────────────────────────

  Gmail         LINE WORKS    Google         Google        freee / TKC
  (メール)      (通知・連絡)   Calendar       Drive/Sheets  (経営数値)

──────────────────────────────────────────────────────────────────
Layer 2: Provider層 — 外部サービスを「判断軸」に変換
──────────────────────────────────────────────────────────────────

  Inbox           Schedule        File            BusinessData
  Provider        Provider        Provider        Provider
  ・Gmail         ・Calendar      ・Drive         ・Sheets
  ・LINE WORKS    （Phase 6）     （将来）         ・freee
  （デモ接続）                                    ・TKC
                                                  （将来）

  Workflow        Notification
  Provider        Provider
  ・承認フロー    ・LINE WORKS通知
  ・下書き        ・アラート
  （将来）        （Phase 9 デモ接続）

──────────────────────────────────────────────────────────────────
Layer 3: AI Engine層 — 横断判断・優先度付け・リスク検知
──────────────────────────────────────────────────────────────────

  Normalizer     PriorityEngine   RiskEngine      BriefingEngine
  ↓              ↓                ↓               ↓
  統一型に変換   横断優先度付け   リスク横断検知  ブリーフィング生成

  ActionEngine   SearchEngine     ApprovalEngine
  ↓              ↓                ↓
  推奨アクション 横断検索         承認ゲート
  （提案のみ）                    （書き込み禁止）

──────────────────────────────────────────────────────────────────
Layer 4: 画面層 — 社長が判断するための情報を表示
──────────────────────────────────────────────────────────────────

  ホーム          AIコックピット    今日の要対応     設定
  ・ブリーフィング ・横断優先度TOP5  ・Inboxタスク   ・Provider状態
  ・状況カード    ・健康スコア      ・詳細モーダル  ・接続管理
  ・Gmailサマリー ・Gmailセクション  ・返信下書き
```

---

## ファイル構成（Phase 5.5 追加分）

```
client/src/core/
├── providers/
│   ├── providerTypes.ts       — 全Provider共通型・Unified統合型
│   ├── inboxProvider.ts       — Inbox Provider（Gmail → UnifiedInboxItem）
│   ├── scheduleProvider.ts    — Schedule Provider stub（Phase 6: Calendar）
│   ├── fileProvider.ts        — File Provider stub（将来: Drive）
│   ├── businessDataProvider.ts — BusinessData Provider stub（将来: Sheets/freee/TKC）
│   ├── workflowProvider.ts    — Workflow Provider stub（将来: 承認フロー）
│   ├── notificationProvider.ts — Notification Provider stub（将来: アラート）
│   ├── providerRegistry.ts    — 全Provider一覧・取得窓口
│   └── providerHealth.ts      — Provider健全性チェック
└── ai-engine/
    ├── aiEngineTypes.ts       — AI Engine共通型
    ├── normalizer.ts          — サービスデータ → 統合型への変換
    ├── priorityEngine.ts      — 横断優先度スコアリング
    ├── briefingEngine.ts      — 朝ブリーフィング生成
    ├── riskEngine.ts          — 横断リスク検知
    ├── actionEngine.ts        — 推奨アクション生成（外部実行なし）
    ├── searchEngine.ts        — 横断検索
    └── approvalEngine.ts      — 社長承認ゲート（外部書き込み禁止）
```

---

## Provider別接続状況（Phase 9 時点）

| Provider | 接続状態 | データソース | 次フェーズ |
|---------|---------|------------|---------|
| Inbox Provider | デモ接続 | Gmail + LINE WORKS（デモ） | — |
| Schedule Provider | 未接続 | — | Google Calendar（Phase 6） |
| File Provider | 未接続 | — | Google Drive（将来） |
| BusinessData Provider | デモ接続 | Google Sheets（デモ） | freee / TKC（将来） |
| Workflow Provider | 未接続 | — | 社長承認フロー（将来） |
| Notification Provider | デモ接続 | LINE WORKS通知（デモ）| OAuth2本番接続（Phase 10） |

---

## 安全設計

```
外部サービス → Provider → Normalizer → AI Engine → 画面表示
                                          ↓
                                   推奨アクション（提案のみ）
                                          ↓
                                   ApprovalEngine（承認ゲート）
                                          ↓
                                   社長承認後 → 将来の実行フロー
                                   （現フェーズでは実行機能も未実装）
```

- **書き込みAPIは一切実装していない**（ActionEngine は提案のみ）
- **ApprovalEngine**: 社長承認なしに外部実行できない設計
- **readOnly: true** が全Providerのデフォルト
