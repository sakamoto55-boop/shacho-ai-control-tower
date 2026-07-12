# V1_SAFETY_LOCK.md — v1.0.0 安全凍結宣言

> Phase 10 完了 · v1.0.0 確定  
> このファイルは AI社長室 v1.0.0 の安全設計を確認・宣言するものです。

---

## 安全凍結の概要

v1.0.0 において、以下のすべての「禁止操作」が実装されていないことを宣言します。  
禁止操作は Phase 11以降も、バックエンドProxy + 社長承認ゲートを経由した場合にのみ検討されます。

---

## 明示的禁止操作一覧

### Gmail

| 操作 | 状態 | 確認方法 |
|------|------|---------|
| メール送信 | ❌ 未実装 | `gmailFetcher.ts`: `sendMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 返信送信 | ❌ 未実装 | `gmailFetcher.ts`: `replyMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 既読化 | ❌ 未実装 | `gmailFetcher.ts`: `markAsRead()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 削除 | ❌ 未実装 | `gmailFetcher.ts`: `deleteMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| ラベル変更 | ❌ 未実装 | `gmailFetcher.ts`: `modifyLabels()` → `throw new Error('WRITE_FORBIDDEN: ...')` |

### LINE WORKS

| 操作 | 状態 | 確認方法 |
|------|------|---------|
| メッセージ送信 | ❌ 未実装 | `lineworksFetcher.ts`: `sendMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 返信送信 | ❌ 未実装 | `lineworksFetcher.ts`: `replyMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 既読化 | ❌ 未実装 | `lineworksFetcher.ts`: `markAsRead()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| Bot送信 | ❌ 未実装 | `lineworksFetcher.ts`: `sendBotMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| Webhook本番受信 | ❌ 未実装 | バックエンドサーバーなし（SPAのみ）|
| 削除 | ❌ 未実装 | `lineworksFetcher.ts`: `deleteMessage()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| チャンネル操作 | ❌ 未実装 | `lineworksFetcher.ts`: `createChannel()` → `throw new Error('WRITE_FORBIDDEN: ...')` |

### Google Calendar

| 操作 | 状態 | 確認方法 |
|------|------|---------|
| 予定作成 | ❌ 未実装 | `calendarFetcher.ts`: `createEvent()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 予定更新 | ❌ 未実装 | `calendarFetcher.ts`: `updateEvent()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 予定削除 | ❌ 未実装 | `calendarFetcher.ts`: `deleteEvent()` → `throw new Error('WRITE_FORBIDDEN: ...')` |

### Google Drive

| 操作 | 状態 | 確認方法 |
|------|------|---------|
| ファイル作成 | ❌ 未実装 | `driveFetcher.ts`: `createFile()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| ファイル更新 | ❌ 未実装 | `driveFetcher.ts`: `updateFile()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| ファイル削除 | ❌ 未実装 | `driveFetcher.ts`: `deleteFile()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 共有権限変更 | ❌ 未実装 | `driveFetcher.ts`: `shareFile()` → `throw new Error('WRITE_FORBIDDEN: ...')` |

### Google Sheets

| 操作 | 状態 | 確認方法 |
|------|------|---------|
| セル更新 | ❌ 未実装 | `sheetsFetcher.ts`: `updateCell()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| 行追加 | ❌ 未実装 | `sheetsFetcher.ts`: `appendRow()` → `throw new Error('WRITE_FORBIDDEN: ...')` |
| シート作成 | ❌ 未実装 | `sheetsFetcher.ts`: `createSheet()` → `throw new Error('WRITE_FORBIDDEN: ...')` |

---

## ActionDraft 安全確認

全 ActionDraft（承認キュー）に以下のフィールドが設定されていることを確認します：

```typescript
// actionDraftEngine.ts — 全 ActionDraft に必須
externalSendDisabled: true   // 外部送信禁止
saveDisabled: true           // 外部保存禁止
readOnly: true               // 読み取り専用
writeEnabled: false          // 書き込み無効
requiresApproval: true       // 社長承認必須
approvalStatus: 'pending'    // 承認待ち（実行なし）
```

---

## 秘密情報・APIキー管理

| 項目 | 状態 | 確認方法 |
|------|------|---------|
| LINEWORKS_CLIENT_SECRET フロントエンド配置 | ❌ 禁止・未配置 | `.env.example` のコメント参照 |
| APIキーのコード直書き | ❌ 禁止・未存在 | `src/` 全体に API key ハードコードなし |
| `client/.env` のコミット | ❌ 禁止 | `.gitignore` に `.env` が含まれている |

---

## 自動判断禁止事項

以下について、AIが自動確定・自動実行することは v1.0.0 では一切ありません：

- 金額・見積・契約の自動確定
- 納期の自動変更
- 謝罪・責任認定の自動送信
- 外注費・労務費の自動承認
- 事故報告の自動対外送信

---

## 凍結宣言

```
v1.0.0 は読み取り専用 MVP です。
外部への書き込みは一切なし。
社長が画面で確認・判断した内容を、
将来の Phase 11 以降で安全に実行する設計の準備を行っています。
```

最終確認日: 2026-06-27  
確認者: Phase 10 実装（AI Engine統合 · 社長承認フロー設計）
