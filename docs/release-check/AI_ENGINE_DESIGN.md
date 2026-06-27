# AI_ENGINE_DESIGN.md — AI Engine設計仕様

> 最終更新: Phase 5.5 — v0.5.5（2026-06-27）

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
入力: UnifiedInboxItem[], UnifiedScheduleItem[], UnifiedRisk[]
出力: PriorityScore[], UnifiedInboxItem[]（ランク順）, string[]（TOPアクション）

スコア計算（0-100）:
  基準値: 50
  優先度A: +30 / 優先度B: +10 / 優先度C: -10
  期限あり: +15
  重要タイプ（銀行/事故）: +10
  要注意タイプ（請求/契約）: +5
  返信下書きあり: +5
```

### BriefingEngine

```
入力: UnifiedInboxItem[], UnifiedRisk[]
出力: BriefingSection[]

セクション:
  1. 受信トレイ 要対応（優先度A）
  2. 検知リスク（critical/high）
  3. 本日の推奨アクション（deadline付き）

将来: schedule, businessMetrics も受け取り
```

### RiskEngine

```
入力:
  detectFromInbox(): UnifiedInboxItem[]
  detectFromBusinessData(): UnifiedBusinessMetric[]
出力: UnifiedRisk[]

キーワード検知:
  事故/労災 → 事故リスク
  未払い/未回収 → 未回収リスク
  未請求 → 未請求リスク
  資金/口座残高 → 資金繰りリスク
  契約終了/期限 → 契約期限リスク
  人員不足/退職 → 人員不足リスク

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
  search(query, inbox[]): UnifiedInboxItem[]
  subject / from / bodyPreview / taskType でキーワード検索

将来: searchSchedule(), searchFiles(), searchBusinessData()
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
