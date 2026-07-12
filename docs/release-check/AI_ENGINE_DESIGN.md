# AI_ENGINE_DESIGN.md — AI Engine設計仕様

> 最終更新: Phase 10 — v1.0.0（2026-06-27）

---

## Phase 10 新規エンジン詳細（v1.0.0）

### CrossProviderContext（`crossProviderContext.ts`）

```
入力: UnifiedInboxItem[], UnifiedScheduleItem[], UnifiedFileItem[],
      UnifiedBusinessMetric[], UnifiedNotification[]
出力: CrossProviderContext[]

テーマ: 銀行融資リスク / 未回収・未請求 / 事故SOS /
        人員不足 / 現場お結び問題 / 経営異常値
```

各コンテキストに `evidenceSources[]`（最大4件）・`riskLevel`・`urgency`・`requiresApproval` を付与。

### CompanyHealthEngine（`companyHealthEngine.ts`）

```
入力: UnifiedBusinessMetric[], UnifiedNotification[], UnifiedScheduleItem[]
出力: CompanyHealthScore

9カテゴリ:
  cashflow / grossProfit / unbilled / uncollected /
  accident / personnel / sales / internalSOS / scheduleLoad

グレード: A（90+）/ B（70-89）/ C（50-69）/ D（50未満）
```

### DecisionEngine（`decisionEngine.ts`）

```
入力: inbox, schedule, metrics, notifications, crossContexts
出力: DecisionItem[] TOP7（urgency降順 → importance順）

優先順位:
  1. 緊急通知（urgency=critical）
  2. 横断コンテキスト（importance=A かつ urgency≠low）
  3. 受信箱優先度A
  4. 経営数値危険指標（riskLevel=critical or high）
  5. 今日の重要予定（priority=A かつ 今日）
```

各 `DecisionItem` は `readOnly: true` / `writeEnabled: false` 必須。

### ActionDraftEngine（`actionDraftEngine.ts`）

```
入力: inbox, notifications, decisions
出力: ActionDraft[] 最大6件

生成対象:
  1. 受信箱 priority=A かつ requiresApproval=true → 返信下書き
  2. 通知 urgency=critical or (high かつ riskFlag=true) → 対応連絡下書き
  3. decisions category=bank かつ importance=A → 確認依頼下書き

全件必須フィールド:
  externalSendDisabled: true
  saveDisabled: true
  readOnly: true
  writeEnabled: false
  requiresApproval: true
  approvalStatus: 'pending'
```

### ExecutiveBriefing（`executiveBriefing.ts`）

```
入力: inbox, schedule, metrics, notifications, crossContexts, decisions, healthScore
出力: ExecutiveBriefing（朝ブリーフィングテキスト）

内容: greeting / headline / summary / healthGrade /
      topDecisions / topRisks / todaySchedule / actionItems
```

### AI Orchestrator（`aiOrchestrator.ts`）

```
入力: なし（内部で全mockデータ取得）
出力: OrchestratorResult

処理順:
  1. 全Provider mockデータ取得
  2. buildCrossProviderContexts()
  3. calculateCompanyHealth()
  4. detectNotificationRisks() + detectBusinessRisks()
  5. riskClusters生成
  6. buildDecisionList()
  7. buildApprovalQueue()
  8. generateExecutiveBriefing()
  9. buildImmediateActions()
  10. todayPlan生成
  11. OrchestratorResult 返却

呼び出し元（各画面）: useMemo(() => runOrchestrator(), [])
```

---

## AI Engineの役割

AI Engineは複数のProviderからデータを受け取り、横断的に分析・優先度付け・リスク検知・推奨アクション生成を行います。

**重要**: AI Engineは「推奨アクションを提案するだけ」で、外部への書き込みは一切行いません。

---

## エンジン一覧

| エンジン | ファイル | 役割 |
|---------|---------|------|
| Normalizer | `normalizer.ts` | 外部サービスデータ → 統合型への変換 |
| PriorityEngine | `priorityEngine.ts` | 横断優先度スコアリング・ランキング |
| BriefingEngine | `briefingEngine.ts` | 朝ブリーフィングセクション生成 |
| RiskEngine | `riskEngine.ts` | 横断リスク検知（キーワード・数値ベース） |
| ActionEngine | `actionEngine.ts` | 推奨アクション生成（外部実行なし） |
| SearchEngine | `searchEngine.ts` | 横断キーワード検索 |
| ApprovalEngine | `approvalEngine.ts` | 社長承認ゲート（書き込み禁止） |

---

## 各エンジンの入出力

### Normalizer

```
入力: GmailDerivedTask（gmailMapper.tsから）
出力: UnifiedInboxItem

将来追加予定:
  calendarEventToScheduleItem()
  driveFileToFileItem()
  sheetsRowToBusinessMetric()
  freeeDataToBusinessMetric()
  lineWorksMessageToInboxItem()
```

### PriorityEngine

```
入力: UnifiedInboxItem[], UnifiedScheduleItem[], UnifiedRisk[], UnifiedBusinessMetric[], UnifiedNotification[]
出力: PriorityScore[], UnifiedInboxItem[]（ランク順）, string[]（TOPアクション）

スコア計算（0-100）:
  基準値: 50
  優先度A: +30 / 優先度B: +10 / 優先度C: -10
  期限あり: +15
  重要タイプ（銀行/事故）: +10
  要注意タイプ（請求/契約）: +5
  返信下書きあり: +5
  LINE WORKS通知クロス加点（Phase 9追加）:
    urgency=critical && riskFlag=true の通知と関連 → +30
```

### BriefingEngine

```
入力: UnifiedInboxItem[], UnifiedRisk[], UnifiedScheduleItem[], UnifiedBusinessMetric[], UnifiedFileItem[], UnifiedNotification[]
出力: BriefingSection[]

セクション（Phase 9 時点）:
  1. LINE WORKS緊急通知（notification セクション — urgency: critical/high）
  2. 受信トレイ 要対応（inbox — 優先度A）
  3. 経営数字サマリー（business-data — リスクあり指標）
  4. 検知リスク（risk — critical/high）
  5. 本日の推奨アクション（action — deadline付き）

BriefingSection.sectionType:
  'notification' | 'inbox' | 'schedule' | 'business-data' | 'risk' | 'files' | 'action'
```

### RiskEngine

```
入力:
  detectFromInbox(): UnifiedInboxItem[]
  detectFromBusinessData(): UnifiedBusinessMetric[]
  detectFromNotifications(): UnifiedNotification[]  ← Phase 9追加
出力: UnifiedRisk[]

キーワード検知（Inbox）:
  事故/労災 → 事故リスク
  未払い/未回収 → 未回収リスク
  未請求 → 未請求リスク
  資金/口座残高 → 資金繰りリスク
  契約終了/期限 → 契約期限リスク
  人員不足/退職 → 人員不足リスク

LINE WORKS通知ベース（Phase 9追加）:
  category=accident or sos → severity: 'critical', riskType: '事故'
  category=vehicle && riskFlag → severity: 'high', riskType: 'その他'
  category=absence → severity: 'high', riskType: '人員不足'

将来: detectFromSchedule(), detectFromWorkflow()
```

### ActionEngine

```
入力:
  suggestFromInbox(): UnifiedInboxItem[]（優先度A・返信下書きあり）
  suggestFromRisks(): UnifiedRisk[]（critical/high）
出力: UnifiedActionSuggestion[]

全提案に必須:
  requiresApproval: true
  writeEnabled: false

将来: suggestFromSchedule(), suggestFromBusinessData()
```

### SearchEngine

```
現時点:
  searchInbox(query, inbox[]): UnifiedInboxItem[]
  searchSchedule(query, schedule[]): UnifiedScheduleItem[]
  searchFiles(query, files[]): UnifiedFileItem[]
  searchMetrics(query, metrics[]): UnifiedBusinessMetric[]
  searchNotifications(query, notifications[]): UnifiedNotification[]  ← Phase 9追加
  searchAll(query, {inbox, schedule, files, metrics, notifications}): SearchResults

SearchResults（Phase 9 時点）:
  inbox: UnifiedInboxItem[]
  schedule: UnifiedScheduleItem[]
  files: UnifiedFileItem[]
  metrics: UnifiedBusinessMetric[]
  notifications: UnifiedNotification[]  ← Phase 9追加
```

### ApprovalEngine

```
requiresApproval(suggestion): true  ← 常にtrue
createApprovalRequest(suggestion, targetService): UnifiedApprovalRequest
canExecute(request): boolean  ← status === 'approved' の場合のみtrue

GATE_MESSAGE = '社長の承認が必要です。外部APIへの書き込みは承認後のみ実行できます。'

現フェーズでは approve 後の実行機能も未実装（承認状態管理のみ）
```

---

## データフロー（AI Engineを通じた処理）

```
Provider
  │ getItems() → UnifiedInboxItem[] 等
  ↓
Normalizer
  │ 各サービスの型 → 統合型に変換
  ↓
PriorityEngine
  │ スコアリング → ランク付け
  ↓
RiskEngine
  │ リスク横断検知 → UnifiedRisk[]
  ↓
BriefingEngine ── RiskEngine の結果も受け取る
  │ → BriefingSection[] → 画面へ
  ↓
ActionEngine
  │ → UnifiedActionSuggestion[] → 画面へ（提案表示のみ）
  ↓
ApprovalEngine（将来の実行時）
  │ requiresApproval() → true
  │ createApprovalRequest() → 承認待ち
  │ 社長承認 → canExecute() → true
  └ 承認後の実行フロー（現フェーズでは未実装）
```

---

## 将来的なClaude API接続ポイント

現在のAI判定はキーワードベースのルールエンジンです。将来的には以下の箇所でClaude APIを使用できます：

| 現在 | 将来 |
|------|------|
| `gmailAnalyzer.ts` のキーワードルール | Claude APIで本文全体を分析 |
| `priorityEngine.ts` のスコアルール | Claude APIで文脈を考慮した優先度判定 |
| `riskEngine.ts` のキーワード検知 | Claude APIで文脈を考慮したリスク判定 |
| `briefingEngine.ts` の固定フォーマット | Claude APIで自然言語ブリーフィング生成 |
| `actionEngine.ts` の固定テンプレート | Claude APIでパーソナライズされた提案生成 |

**切り替えポイント**: 各エンジンの実装を差し替えるだけで全画面に反映されます。
