# LINE WORKS Notification Provider 設計書（Phase 9）

## 目的

LINE WORKS を AI社長室の Notification Provider / Inbox Provider に接続する準備を行う。
現フェーズ（Phase 9）では「読み取り設計」「通知受信設計」「モックデータ反映」に限定する。

## 絶対禁止事項

以下の操作は一切実装しない：

| 禁止操作 | 理由 |
|---|---|
| メッセージ送信 | 外部書き込み |
| 返信送信 | 外部書き込み |
| 既読化（markAsRead） | 外部状態変更 |
| トーク削除 | 外部書き込み |
| ファイル送信 | 外部書き込み |
| ユーザー追加 | 外部書き込み |
| Bot送信 | 外部書き込み |
| チャンネル投稿 | 外部書き込み |
| Webhook返信 | 外部書き込み |

`lineworksFetcher.ts` の書き込みメソッドはすべて `throw new Error('WRITE_FORBIDDEN: ...')` として実装済み。

## ファイル構成

```
client/src/services/lineworks/
  types.ts                 — LINE WORKS固有型（LineWorksMessage等）
  mockLineworks.ts         — モックデータ9件（通知5+受信箱4）
  lineworksClient.ts       — fetchNotifications/fetchInboxMessages（読み取りのみ）
  lineworksFetcher.ts      — GET専用HTTP薄ラッパー + WRITE_FORBIDDEN ガード
  lineworksMapper.ts       — LineWorksMessage → UnifiedNotification / UnifiedInboxItem
  lineworksAnalyzer.ts     — detectNotificationRisks / createNotificationSummary
  lineworksCache.ts        — 5分TTLキャッシュ（localStorage）
  lineworksWebhookTypes.ts — 将来Webhook受信用型定義のみ
```

## モックデータ内容（9件）

### Notification Provider 用（5件）

| # | タイトル | category | urgency | riskFlag |
|---|---|---|---|---|
| 1 | 事故報告：○○マンション現場 | accident | critical | true |
| 2 | SOS：訪問先□□様が意識もうろう | sos | critical | true |
| 3 | 欠勤連絡：山本花子 | absence | high | false |
| 4 | 車両トラブル：業務用バン | vehicle | high | true |
| 5 | 現場遅延：△△ビル改修工事 | delay | high | false |

### Inbox Provider 用（4件）

| # | タイトル | priority | requiresApproval |
|---|---|---|---|
| 6 | 見積確認依頼：○○建設・△△工事 | A | true |
| 7 | 請求確認：□□介護サービス5月分未入金 | A | true |
| 8 | お結び渋谷店：7月シフト人員不足 | B | false |
| 9 | △△銀行融資審査：試算表確認依頼 | A | true |

## 型定義

### UnifiedNotification（Phase 9 拡張後）

```typescript
interface UnifiedNotification {
  id: string; source: string; providerType: 'notification';
  type: 'alert' | 'info' | 'warning' | 'morning-briefing';
  title: string; body: string; receivedAt: string; priority: 'A'|'B'|'C';
  // Phase 9 追加
  sourceMessageId?: string; senderName?: string; senderDepartment?: string;
  sentAt?: string;
  category?: 'accident'|'absence'|'delay'|'sos'|'vehicle'|'finance'|'operation'|'other';
  urgency?: 'critical'|'high'|'medium'|'low';
  importance?: 'A'|'B'|'C'; requiresAction?: boolean;
  suggestedAction?: string; riskFlag?: boolean; isRead?: boolean;
  actionRequired?: boolean;
  readOnly: true; writeEnabled: false;
}
```

## AI Engine 変更

| ファイル | 変更内容 |
|---|---|
| aiEngineTypes.ts | BriefingSection.sectionType に 'notification' 追加、AnalysisContext に notifications? 追加 |
| priorityEngine.ts | notifications パラメータ追加、重大通知クロス加点 (+30) |
| briefingEngine.ts | notifications パラメータ追加、notification セクション生成 |
| riskEngine.ts | detectFromNotifications() 追加（accident/sos→critical, vehicle/absence→high） |
| searchEngine.ts | SearchResults に notifications フィールド追加、searchNotifications() 追加 |

## 画面変更

| 画面 | 変更内容 |
|---|---|
| CockpitScreen | ティール通知セクション追加（緊急通知カード表示） |
| Home | LINE WORKSカード追加（緊急件数・SOS件数表示） |
| TodayActions | LINE WORKSセクション追加（通知5件＋受信箱4件） |
| AiChat | LINE WORKSショートカットバー6件追加 |
| Settings | v0.9.0、LINE WORKS通知 実装済、デモ接続表示 |

## カラーテーマ（ティール）

```
bg:     #F0FDFA (teal-50)
border: #CCFBF1 (teal-100)
text:   #0F766E (teal-700)
button: #14B8A6 (teal-500)
```

## セキュリティ注意事項

- `VITE_LINEWORKS_CLIENT_SECRET` はフロントエンドに配置しない
- 本番時はバックエンドProxy経由でトークン管理を行う
- Webhook受信エンドポイントはバックエンドのみで管理する

## 将来フェーズ（Phase 10）

- LINE WORKS OAuth2 本番接続
- Webhook受信バックエンドエンドポイント実装
- バックエンドProxy経由での読み取りAPI
