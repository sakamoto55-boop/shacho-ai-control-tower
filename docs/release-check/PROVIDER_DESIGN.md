# PROVIDER_DESIGN.md — Provider設計仕様

> 最終更新: Phase 9 — v0.9.0（2026-06-27）

---

## Providerとは

AI社長室における「Provider」は、外部サービスからのデータを社長の判断軸（受信トレイ・予定・ファイル・経営数値）に変換する中間層です。

```
外部サービス（Gmail, Calendar, Drive...）
      ↓
  Provider（Inbox, Schedule, File, BusinessData...）
      ↓
  統合データ型（UnifiedInboxItem, UnifiedScheduleItem...）
      ↓
  AI Engine / 画面
```

---

## Providerインターフェース

全Providerは以下のインターフェースを実装します：

```typescript
interface Provider<T> {
  getDescriptor(): ProviderDescriptor   // 接続状態・メタデータ
  getItems(): Promise<T[]>              // 統合データを返す
  refresh(): Promise<void>              // キャッシュクリア・再取得
}
```

### ProviderDescriptor

```typescript
interface ProviderDescriptor {
  providerId: string           // 'gmail-inbox', 'google-calendar-schedule'...
  providerName: string         // 'Gmail 受信トレイ', 'Googleカレンダー'...
  providerType: ProviderType   // 'inbox' | 'schedule' | 'file' | ...
  sourceService: string        // 'Gmail' | 'Google Calendar' | ...
  connectionStatus: ProviderConnectionStatus  // 'connected' | 'planned' | ...
  readOnly: boolean            // 常に true（書き込み禁止）
  writeEnabled: boolean        // 常に false（書き込み禁止）
  lastSyncAt: string | null
  healthStatus: ProviderHealthStatus
  errors: string[]
  warnings: string[]
  nextPhase: string | null     // 次フェーズでの予定
}
```

---

## 各Provider一覧

### Inbox Provider（実装済）

| 項目 | 値 |
|------|-----|
| providerId | `gmail-inbox` |
| sourceService | Gmail |
| connectionStatus | disconnected（ClientID未設定）/ connected（設定済み） |
| readOnly | true |
| writeEnabled | false |
| データ型 | `UnifiedInboxItem` |
| Phase | 5（Gmail）/ 将来（LINE WORKS） |

**現状**: mockGmailMessages を使用（`VITE_GOOGLE_CLIENT_ID` 未設定）

---

### Schedule Provider（未接続・Phase 6予定）

| 項目 | 値 |
|------|-----|
| providerId | `google-calendar-schedule` |
| sourceService | Google Calendar |
| connectionStatus | planned |
| スコープ（予定） | `calendar.readonly` |
| データ型 | `UnifiedScheduleItem` |
| Phase | 6 |

---

### File Provider（未接続・将来）

| 項目 | 値 |
|------|-----|
| providerId | `google-drive-file` |
| sourceService | Google Drive |
| connectionStatus | planned |
| スコープ（予定） | `drive.readonly` |
| データ型 | `UnifiedFileItem` |

---

### BusinessData Provider（未接続・将来）

| 項目 | 値 |
|------|-----|
| providerId | `business-data-composite` |
| sourceService | Google Sheets / freee / TKC |
| connectionStatus | planned |
| データ型 | `UnifiedBusinessMetric` |

---

### Workflow Provider（未接続・将来）

| 項目 | 値 |
|------|-----|
| providerId | `workflow-approval` |
| connectionStatus | planned |
| データ型 | `UnifiedWorkflowItem` |
| 注意 | 承認後でも外部書き込みは社長確認必須 |

---

### Notification Provider（Phase 9 デモ接続）

| 項目 | 値 |
|------|-----|
| providerId | `lineworks-notification` |
| providerName | LINE WORKS 通知 |
| sourceService | LINE WORKS |
| connectionStatus | demo（Phase 9）|
| readOnly | true |
| writeEnabled | false |
| データ型 | `UnifiedNotification` |
| Phase | 9（デモ接続） / Phase 10（OAuth2本番） |

**現状**: mockLineWorksNotifications 5件（`VITE_LINEWORKS_BOT_ID` 未設定時）

**書き込み禁止**: `lineworksFetcher.ts` の全10書き込みメソッドが `WRITE_FORBIDDEN` エラーを throw

---

## 新しいProviderを追加するには

1. `client/src/core/providers/` に `xxxProvider.ts` を作成
2. `getDescriptor() / getItems() / refresh()` を実装
3. `providerRegistry.ts` の `ALL_PROVIDERS` に追加
4. Normalizer（`normalizer.ts`）に変換関数を追加
5. `SAFETY_REPORT.md` に接続状態・スコープを記載

---

## 統合データ型（Unified Types）

| 型名 | 用途 |
|------|------|
| `UnifiedInboxItem` | メール・LINE WORKS・通知 |
| `UnifiedScheduleItem` | 予定・会議・期限 |
| `UnifiedFileItem` | ファイル・契約書・案件資料 |
| `UnifiedBusinessMetric` | 売上・粗利・資金繰り・請求・未回収 |
| `UnifiedWorkflowItem` | 承認依頼・下書き・委任 |
| `UnifiedNotification` | アラート・朝ブリーフィング |
| `UnifiedRisk` | 横断リスク（AI Engineが生成） |
| `UnifiedActionSuggestion` | 推奨アクション（提案のみ・外部実行なし） |
| `UnifiedApprovalRequest` | 承認リクエスト（承認後に実行可能） |

---

## 書き込み禁止の設計

全Providerは `writeEnabled: false, readOnly: true` が必須です。
`UnifiedActionSuggestion` の `writeEnabled: false, requiresApproval: true` も必須。
将来の書き込みフローは `ApprovalEngine` を通じて社長承認後のみ実行できます。
