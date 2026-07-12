# V1_ARCHITECTURE_FREEZE.md — v1.0.0 アーキテクチャ凍結宣言

> Phase 10 完了 · v1.0.0 確定  
> このファイルは AI社長室 v1.0.0 のアーキテクチャを確定・凍結するものです。  
> Phase 11 以降の変更は、このドキュメントを起点として差分を管理します。

---

## Provider構成（確定・変更禁止）

| Provider | 接続状態 | データソース | Unified型 |
|---------|---------|------------|---------|
| Inbox Provider | デモ接続 | Gmail（13件）+ LINE WORKS受信箱（4件）| `UnifiedInboxItem` |
| Schedule Provider | デモ接続 | Google Calendar（デモ）| `UnifiedScheduleItem` |
| File Provider | デモ接続 | Google Drive（デモ）| `UnifiedFileItem` |
| BusinessData Provider | デモ接続 | Google Sheets（デモ）| `UnifiedBusinessMetric` |
| Notification Provider | デモ接続 | LINE WORKS通知（5件）| `UnifiedNotification` |

---

## AI Engine構成（Phase 10 確定）

### 既存エンジン（Phase 5.5〜9 実装）

| エンジン | ファイル | 役割 |
|---------|---------|------|
| Normalizer | `normalizer.ts` | 外部データ → 統合型変換 |
| PriorityEngine | `priorityEngine.ts` | 横断優先度スコアリング |
| BriefingEngine | `briefingEngine.ts` | 朝ブリーフィングセクション生成 |
| RiskEngine | `riskEngine.ts` | 横断リスク検知 |
| ActionEngine | `actionEngine.ts` | 推奨アクション生成（外部実行なし）|
| SearchEngine | `searchEngine.ts` | 横断キーワード検索 |
| ApprovalEngine | `approvalEngine.ts` | 社長承認ゲート（書き込み禁止）|

### Phase 10 新規エンジン

| エンジン | ファイル | 役割 |
|---------|---------|------|
| CrossProviderContext | `crossProviderContext.ts` | 全Provider横断コンテキスト生成 |
| CompanyHealthEngine | `companyHealthEngine.ts` | 会社健康スコア（9カテゴリ・グレードA〜D）|
| DecisionEngine | `decisionEngine.ts` | 今日の優先判断リスト TOP7生成 |
| ActionDraftEngine | `actionDraftEngine.ts` | 社長承認用アクション下書き（最大6件）|
| ExecutiveBriefing | `executiveBriefing.ts` | 朝ブリーフィングテキスト生成 |
| AI Orchestrator | `aiOrchestrator.ts` | 全統合 → `OrchestratorResult` 返却 |

---

## 画面構成（6画面・変更禁止原則）

| 画面 | ファイル | 主要データソース |
|------|---------|--------------|
| ホーム | `Home.tsx` | briefing · healthScore · notifications |
| AIコックピット | `CockpitScreen.tsx` | decisions · approvalQueue · healthScore · notifications |
| 今日の要対応 | `TodayActions.tsx` | decisions · inbox · notifications |
| AI相談 | `AiChat.tsx` | orchestratorResult（全統合）|
| 経営ダッシュボード | `Dashboard.tsx` | healthScore · metrics |
| 設定 | `Settings.tsx` | Provider接続状況 · バージョン情報 |

---

## データフロー（確定）

```
外部サービス（Gmail / Calendar / Drive / Sheets / LINE WORKS）
        ↓
  サービス層（mockData / fetcher / mapper）
        ↓
  Provider層（5 Provider）
        ↓
  Unified型（UnifiedInboxItem / UnifiedScheduleItem / UnifiedFileItem
             / UnifiedBusinessMetric / UnifiedNotification）
        ↓
  AI Engine（aiOrchestrator.runOrchestrator()）
   ├── crossProviderContext → CrossProviderContext[]
   ├── companyHealthEngine → CompanyHealthScore
   ├── decisionEngine → DecisionItem[] (TOP7)
   ├── actionDraftEngine → ActionDraft[] (最大6件)
   └── executiveBriefing → ExecutiveBriefing
        ↓
  OrchestratorResult（useMemo で各画面に配布）
        ↓
  画面表示（6画面）
```

---

## ファイルツリー（Phase 10 確定）

```
client/src/
├── core/
│   ├── providers/
│   │   ├── providerTypes.ts          — 全統合型定義
│   │   ├── inboxProvider.ts          — Inbox Provider
│   │   ├── scheduleProvider.ts       — Schedule Provider
│   │   ├── fileProvider.ts           — File Provider
│   │   ├── businessDataProvider.ts   — BusinessData Provider
│   │   ├── notificationProvider.ts   — Notification Provider
│   │   ├── workflowProvider.ts       — stub（Phase 11以降）
│   │   ├── providerRegistry.ts       — Provider一覧
│   │   └── providerHealth.ts         — 健全性チェック
│   └── ai-engine/
│       ├── aiEngineTypes.ts          — AI Engine共通型
│       ├── normalizer.ts             — データ変換
│       ├── priorityEngine.ts         — 優先度スコアリング
│       ├── briefingEngine.ts         — ブリーフィング生成
│       ├── riskEngine.ts             — リスク検知
│       ├── actionEngine.ts           — 推奨アクション
│       ├── searchEngine.ts           — 横断検索
│       ├── approvalEngine.ts         — 承認ゲート
│       ├── crossProviderContext.ts   — 横断コンテキスト（Phase 10）
│       ├── companyHealthEngine.ts    — 健康スコア（Phase 10）
│       ├── decisionEngine.ts         — 判断リスト（Phase 10）
│       ├── actionDraftEngine.ts      — 承認下書き（Phase 10）
│       ├── executiveBriefing.ts      — 朝ブリーフィング（Phase 10）
│       └── aiOrchestrator.ts         — AI統合オーケストレータ（Phase 10）
├── services/
│   ├── gmail/                        — Gmail サービス層
│   ├── calendar/                     — Calendar サービス層
│   ├── drive/                        — Drive サービス層
│   ├── sheets/                       — Sheets サービス層
│   └── lineworks/                    — LINE WORKS サービス層
└── components/
    ├── Navigation.tsx                — 5タブナビゲーション
    └── screens/
        ├── Home.tsx
        ├── CockpitScreen.tsx
        ├── TodayActions.tsx
        ├── AiChat.tsx
        ├── Dashboard.tsx
        └── Settings.tsx
```

---

## 固定原則（変更禁止）

1. **画面を増やしすぎない** — 6画面を基本とする（Phase 11で追加する場合は検討）
2. **Provider経由で接続する** — 直接サービス呼び出し禁止（画面から `gmailFetcher` を直接呼ばない）
3. **AI Engineで横断判断する** — 各Providerで個別判断しない（`aiOrchestrator` 経由）
4. **社長承認前に外部実行しない** — `externalSendDisabled: true` を外さない
5. **ReadOnly優先** — `readOnly: true, writeEnabled: false` はデフォルト
6. **CLIENT_SECRET はフロントエンドに置かない** — バックエンドProxy（Phase 11）まで保留

---

## 凍結宣言

```
v1.0.0 のアーキテクチャは上記のとおり確定しました。
Phase 11 以降の変更は、以下のルールに従います：

1. このドキュメントに差分を記録する
2. Provider追加は providerRegistry.ts を更新する
3. AI Engine追加は aiOrchestrator.ts を更新する
4. 画面追加は Navigation.tsx のタブ設計を見直す
5. 書き込み操作は ApprovalEngine 経由でのみ許可する
```

最終確認日: 2026-06-27  
確定バージョン: v1.0.0 Phase 10
