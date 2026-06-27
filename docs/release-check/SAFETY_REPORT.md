# SAFETY_REPORT.md — 外部API接続状況・安全設計確認書

> 最終更新: Phase 10 — v1.0.0（2026-06-27）  
> このファイルは外部API接続・書き込み処理の有無を確認するための文書です。

---

## Phase 11 追加安全確認（Gmail ReadOnly 本番接続）

| チェック項目 | 状態 |
|------------|------|
| 新規外部接続 | ✅ Google Gmail API（`gmail.readonly` のみ・本番）|
| 要求スコープ | ✅ gmail.readonly のみ（calendar/drive/sheets/send/modify は要求しない）|
| Gmail 書き込みAPI | ❌ なし（sendMessage/replyMessage/createDraft/deleteMessage/archiveMessage/markAsRead/modifyLabels/addStar すべて未実装）|
| `gmailFetcher.ts` のHTTPメソッド | ✅ GET のみ |
| POST の用途 | ✅ OAuth トークン交換・リフレッシュのみ（oauth2.googleapis.com/token）|
| client_secret のフロント配置 | ❌ なし（SPA では使用しない）|
| `.env` のコミット | ❌ なし（.gitignore で除外・public でも秘密情報なし）|
| 取得データの用途 | ✅ 表示・AI判定のみ（外部書き込みなし）|
| Calendar/Drive/Sheets/LINE WORKS | ✅ デモのまま（本番接続なし）|

詳細は `PRODUCTION_SECURITY_CHECK.md` を参照。

---

## Phase 10 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ❌ なし（全Provider デモモックのまま） |
| 外部API 書き込み追加 | ❌ なし（全 WRITE_FORBIDDEN 維持） |
| `ActionDraft.externalSendDisabled` | ✅ 全件 `true`（`actionDraftEngine.ts` 3箇所確認） |
| `ActionDraft.saveDisabled` | ✅ 全件 `true`（外部保存なし） |
| `ActionDraft.readOnly` | ✅ 全件 `true` |
| `ActionDraft.writeEnabled` | ✅ 全件 `false` |
| `aiOrchestrator.ts` 外部HTTP呼び出し | ❌ なし（全データ mock から取得） |
| `OrchestratorResult` 書き込みフラグ | ✅ `todayPlan.readOnly: true` / `todayPlan.writeEnabled: false` |
| 承認フロー外部実行 | ❌ なし（UIと型のみ・外部実行は Phase 11以降） |
| APIキー直書き | ❌ なし（`.env.example` のみ） |

## ActionDraft 安全設計確認

`actionDraftEngine.ts` で生成される全 ActionDraft の安全フィールド：

```typescript
// 受信箱からの返信下書き（line 22〜36）
externalSendDisabled: true,
saveDisabled: true,
readOnly: true,
writeEnabled: false,

// 緊急通知からの対応連絡下書き（line 42〜56）
externalSendDisabled: true,
saveDisabled: true,
readOnly: true,
writeEnabled: false,

// 決断リストからの確認依頼下書き（line 63〜78）
externalSendDisabled: true,
saveDisabled: true,
readOnly: true,
writeEnabled: false,
```

---

## Phase 9 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ✅ LINE WORKS 読み取り専用のみ（デモモード） |
| LINE WORKS 書き込みAPI追加 | ❌ なし（sendMessage/replyMessage/markAsRead/deleteMessage等 WRITE_FORBIDDEN実装） |
| フロントへの秘密鍵配置 | ❌ なし（VITE_LINEWORKS_CLIENT_SECRET はenv.exampleに記載禁止） |
| `lineworksFetcher.ts` の HTTP メソッド | ✅ GET のみ（書き込み系は throw new Error('WRITE_FORBIDDEN')） |
| `UnifiedNotification` の書き込みフラグ | ✅ `readOnly: true` / `writeEnabled: false` |
| Webhook返信 | ❌ 実装なし（受信型定義のみ） |
| 個人LINE接続 | ❌ 実装なし（CLAUDE.md 制約どおり） |

## LINE WORKS 書き込み禁止の確認

### 禁止されている処理と実装状態

| 処理 | 関数名 | 実装状態 | 証拠 |
|------|--------|---------|------|
| メッセージ送信 | `sendMessage` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| 返信送信 | `replyMessage` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| 既読化 | `markAsRead` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| メッセージ削除 | `deleteMessage` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| チャンネル投稿 | `postToChannel` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| Bot送信 | `sendBotMessage` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| ユーザー追加 | `addMember` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| ファイル送信 | `sendFile` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| メッセージ更新 | `updateMessage` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |
| チャンネル作成 | `createChannel` | WRITE_FORBIDDEN | `lineworksFetcher.ts` |

---

## Phase 8 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ✅ Google Sheets ReadOnly のみ（`spreadsheets.readonly` スコープ） |
| Sheets 書き込み API 追加 | ❌ なし（updateCell/appendRow/deleteRow/createSheet/deleteSheet/shareSheet/changePermission/formatCell 未実装） |
| Sheets スコープ | ✅ `spreadsheets.readonly` のみ（`spreadsheets` フルアクセスは取得しない） |
| Gmail / Calendar / Drive スコープ変更 | ❌ なし（既存スコープを継続） |
| `sheetsFetcher.ts` の HTTP メソッド | ✅ GET のみ（POST/PATCH/PUT/DELETE なし） |
| `UnifiedBusinessMetric` の書き込みフラグ | ✅ `readOnly: true as const` / `writeEnabled: false as const` |
| PHASE8_SCOPES 定義 | ✅ gmail.readonly + calendar.readonly + drive.readonly + spreadsheets.readonly のみ |
| 個人LINE接続 | ❌ 実装なし（CLAUDE.md 制約どおり） |
| LINE WORKS / freee / kintone 接続 | ❌ 未接続（stub のみ） |

## Sheets 書き込み禁止の確認

### 禁止されている処理と実装状態

| 処理 | 関数名 | 実装状態 | 証拠ファイル |
|------|--------|---------|------------|
| セル更新 | `updateCell` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| 行追加 | `appendRow` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| 行削除 | `deleteRow` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| シート作成 | `createSheet` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| シート削除 | `deleteSheet` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| 共有設定変更 | `shareSheet` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| 権限変更 | `changePermission` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |
| セル書式変更 | `formatCell` | **未実装** | `sheetsFetcher.ts`: GET のみ・コメント明記 |

### HTTP メソッドの使用状況（Sheets）

| ファイル | GET | POST | PATCH | PUT | DELETE |
|---------|-----|------|-------|-----|--------|
| `sheetsFetcher.ts` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `sheetsClient.ts` | ✅（fetch委譲） | ❌ | ❌ | ❌ | ❌ |

---

## Phase 7 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ✅ Google Drive ReadOnly のみ（`drive.readonly` スコープ） |
| Drive 書き込み API 追加 | ❌ なし（createFile/updateFile/deleteFile/moveFile/shareFile/changePermission/uploadFile/copyFile/addComment 未実装） |
| Drive スコープ | ✅ `drive.readonly` のみ（`drive` / `drive.file` は取得しない） |
| Gmail / Calendar スコープ変更 | ❌ なし（既存スコープを継続） |
| `driveFetcher.ts` の HTTP メソッド | ✅ GET のみ（POST/PATCH/PUT/DELETE なし） |
| `UnifiedFileItem` の書き込みフラグ | ✅ `readOnly: true as const` / `writeEnabled: false as const` |
| PHASE7_SCOPES 定義 | ✅ gmail.readonly + calendar.readonly + drive.readonly のみ |
| FORBIDDEN_SCOPES に `drive` を含む | ✅ フルアクセス drive スコープを禁止リストに追加 |
| 個人LINE接続 | ❌ 実装なし（CLAUDE.md 制約どおり） |
| Sheets / LINE WORKS / freee 接続 | ❌ 未接続（stub のみ） |

## Drive 書き込み禁止の確認

### 禁止されている処理と実装状態

| 処理 | 関数名 | 実装状態 | 証拠ファイル |
|------|--------|---------|------------|
| ファイル作成 | `createFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| ファイル更新 | `updateFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| ファイル削除 | `deleteFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| ファイル移動 | `moveFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| 権限変更 | `changePermission` | **未実装** | `driveFetcher.ts`: GET のみ |
| 共有設定変更 | `shareFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| フォルダ作成 | `createFolder` | **未実装** | `driveFetcher.ts`: GET のみ |
| アップロード | `uploadFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| コピー作成 | `copyFile` | **未実装** | `driveFetcher.ts`: GET のみ |
| コメント追加 | `addComment` | **未実装** | `driveFetcher.ts`: GET のみ |

### HTTP メソッドの使用状況（Drive）

| ファイル | GET | POST | PATCH | PUT | DELETE |
|---------|-----|------|-------|-----|--------|
| `driveFetcher.ts` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `driveClient.ts` | ✅（fetchFiles委譲） | ❌ | ❌ | ❌ | ❌ |

---

## 現在の外部API接続状況（Phase 8 更新）

| サービス | 接続状態 | スコープ | 書き込み |
|---------|---------|---------|---------|
| Google OAuth | ✅ 構造実装済み（ClientID未設定なら未接続） | — | なし |
| Gmail API | 🔧 ClientID設定後に有効 | `gmail.readonly` のみ | **なし** |
| Google Calendar | 🔧 ClientID + calendar.readonly 設定後に有効 | `calendar.readonly` のみ | **なし** |
| Google Drive | 🔧 ClientID + drive.readonly 設定後に有効 | `drive.readonly` のみ | **なし** |
| Google Sheets | ❌ 未接続 | 未取得 | なし |
| LINE WORKS | ❌ 未接続 | 未取得 | なし |
| Claude API | ❌ 未接続 | — | なし |
| freee | ❌ 未接続 | — | なし |
| kintone | ❌ 未接続 | — | なし |

---

## Phase 6 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ✅ Google Calendar ReadOnly のみ（`calendar.readonly` スコープ） |
| Calendar 書き込み API 追加 | ❌ なし（createEvent/updateEvent/deleteEvent/respondEvent/attendeeModify 未実装） |
| Calendar スコープ | ✅ `calendar.readonly` のみ（`calendar` / `calendar.events` は取得しない） |
| Gmail スコープ変更 | ❌ なし（`gmail.readonly` のみ継続） |
| `calendarFetcher.ts` の HTTP メソッド | ✅ GET のみ（POST/PATCH/PUT/DELETE なし） |
| 書き込みスコープ混入チェック | ✅ `hasWriteScope()` 関数で検証可能 |
| FORBIDDEN_SCOPES 定義 | ✅ googleScopes.ts に禁止スコープを明示 |
| 個人LINE接続 | ❌ 実装なし（CLAUDE.md 制約どおり） |
| Drive / Sheets 接続 | ❌ 未接続（Phase 7予定） |
| freee / TKC / kintone 接続 | ❌ 未接続（stub のみ） |
| Claude API 接続 | ❌ 未接続（将来ポイントのみ記載） |

---

## Calendar 書き込み禁止の確認

### 禁止されている処理と実装状態

| 処理 | 関数名 | 実装状態 | 証拠ファイル |
|------|--------|---------|------------|
| 予定作成 | `createEvent` | **未実装** | `calendarFetcher.ts`: GET のみ |
| 予定更新 | `updateEvent` | **未実装** | `calendarFetcher.ts`: GET のみ |
| 予定削除 | `deleteEvent` | **未実装** | `calendarFetcher.ts`: GET のみ |
| 招待返信 | `respondEvent` | **未実装** | `calendarFetcher.ts`: GET のみ |
| 出席者変更 | `attendeeModify` | **未実装** | `calendarFetcher.ts`: GET のみ |
| 通知送信 | `sendNotification` | **未実装** | `calendarFetcher.ts`: GET のみ |

### HTTP メソッドの使用状況（Calendar）

| ファイル | GET | POST | PATCH | PUT | DELETE |
|---------|-----|------|-------|-----|--------|
| `calendarFetcher.ts` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `calendarClient.ts` | ✅（fetchEvents委譲） | ❌ | ❌ | ❌ | ❌ |

---

## 現在の外部API接続状況（Phase 6 更新）

| サービス | 接続状態 | スコープ | 書き込み |
|---------|---------|---------|---------|
| Google OAuth | ✅ 構造実装済み（ClientID未設定なら未接続） | — | なし |
| Gmail API | 🔧 ClientID設定後に有効 | `gmail.readonly` のみ | **なし** |
| Google Calendar | 🔧 ClientID + calendar.readonly 設定後に有効 | `calendar.readonly` のみ | **なし** |
| Google Drive | ❌ 未接続 | 未取得 | なし |
| Google Sheets | ❌ 未接続 | 未取得 | なし |
| LINE WORKS | ❌ 未接続 | 未取得 | なし |
| Claude API | ❌ 未接続 | — | なし |
| freee | ❌ 未接続 | — | なし |
| kintone | ❌ 未接続 | — | なし |

---

## Phase 5.5 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ❌ なし（アーキテクチャ設計のみ） |
| 書き込み API 追加 | ❌ なし |
| スコープ追加 | ❌ なし（gmail.readonly のみ継続） |
| `core/providers/` のすべてのProvider | ✅ `writeEnabled: false` `readOnly: true` 固定 |
| `core/ai-engine/` のActionEngine | ✅ `requiresApproval: true` `writeEnabled: false` 固定 |
| ApprovalEngine のゲート | ✅ `canExecute()` が true の場合のみ実行可（現フェーズでは実行機能も未実装） |
| 個人LINE接続 | ❌ 実装なし（CLAUDE.md 制約どおり） |
| Claude API 接続 | ❌ 未接続（将来ポイントのみ記載） |
| freee / TKC / kintone 接続 | ❌ 未接続（stub のみ） |

---

## 現在の外部API接続状況

| サービス | 接続状態 | スコープ | 書き込み |
|---------|---------|---------|---------|
| Google OAuth | ✅ 構造実装済み（ClientID未設定なら未接続） | — | なし |
| Gmail API | 🔧 ClientID設定後に有効 | `gmail.readonly` のみ | **なし** |
| Google Calendar | ❌ 未接続 | 未取得 | なし |
| Google Drive | ❌ 未接続 | 未取得 | なし |
| Google Sheets | ❌ 未接続 | 未取得 | なし |
| LINE WORKS | ❌ 未接続 | 未取得 | なし |
| Claude API | ❌ 未接続 | — | なし |
| freee | ❌ 未接続 | — | なし |
| kintone | ❌ 未接続 | — | なし |

---

## Gmail 書き込み禁止の確認

### 禁止されている処理と実装状態

| 処理 | 関数名 | 実装状態 | 証拠ファイル |
|------|--------|---------|------------|
| メール送信 | `sendMessage` | **未実装** | `gmailFetcher.ts`: GET のみ |
| メール返信 | `replyMessage` | **未実装** | `gmailFetcher.ts`: GET のみ |
| 下書き作成 | `createDraft` | **未実装** | `gmailFetcher.ts`: GET のみ |
| メール削除 | `deleteMessage` | **未実装** | `gmailFetcher.ts`: GET のみ |
| アーカイブ | `archiveMessage` | **未実装** | `gmailFetcher.ts`: GET のみ |
| 既読化 | `markAsRead` | **未実装** | `gmailFetcher.ts`: GET のみ |
| 未読化 | `markAsUnread` | **未実装** | `gmailFetcher.ts`: GET のみ |
| スター付与 | `addStar` | **未実装** | `gmailFetcher.ts`: GET のみ |
| ラベル変更 | `modifyLabels` | **未実装** | `gmailFetcher.ts`: GET のみ |
| メール移動 | `moveMessage` | **未実装** | `gmailFetcher.ts`: GET のみ |

### HTTP メソッドの使用状況

| ファイル | GET | POST | PATCH | PUT | DELETE |
|---------|-----|------|-------|-----|--------|
| `gmailFetcher.ts` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `googleAuth.ts` | ✅ | ✅（トークン交換のみ） | ❌ | ❌ | ❌ |
| `googleToken.ts` | ❌ | ✅（トークンリフレッシュのみ） | ❌ | ❌ | ❌ |

> `googleAuth.ts` と `googleToken.ts` の POST は Google の OAuth トークンエンドポイント (`/token`) 専用です。  
> Gmail API への POST は存在しません。

---

## OAuth スコープの確認

### Phase 5 で取得するスコープ

```
https://www.googleapis.com/auth/gmail.readonly
```

### 取得しないスコープ（禁止）

```
https://www.googleapis.com/auth/gmail.modify    ← 禁止
https://www.googleapis.com/auth/gmail.send      ← 禁止
https://www.googleapis.com/auth/gmail.compose   ← 禁止
https://mail.google.com/                        ← 禁止（フルアクセス）
https://www.googleapis.com/auth/calendar        ← 未取得（Phase 6以降）
https://www.googleapis.com/auth/drive           ← 未取得（未定）
```

確認コード（`client/src/services/google/googleScopes.ts`）:
```typescript
export const PHASE5_SCOPES: GoogleScope[] = [
  GOOGLE_SCOPES.GMAIL_READONLY  // これのみ
]
```

---

## データ保存先の確認

| データ種別 | 保存先 | 外部送信 |
|-----------|--------|---------|
| OAuth アクセストークン | `localStorage`（クライアントのみ） | なし |
| OAuth リフレッシュトークン | `localStorage`（クライアントのみ） | なし |
| PKCE コードベリファイア | `sessionStorage`（クライアントのみ） | なし |
| Gmail メッセージキャッシュ | `localStorage`（クライアントのみ） | なし |
| 認証ログ | `localStorage`（クライアントのみ） | なし |
| mockGmail データ | クライアントメモリのみ | なし |

---

## 個人情報の取り扱い

| 情報 | 取得方法 | 外部送信 |
|-----|---------|---------|
| Google アカウントのメールアドレス | `/oauth2/v3/userinfo`（接続確認用のみ） | なし |
| Gmail メッセージ本文 | Gmail API（ReadOnly） | なし（ローカルキャッシュのみ） |
| Gmail の送信者情報 | Gmail API（ReadOnly） | なし |

---

## フェーズ別書き込み処理実装予定

| フェーズ | 処理 | 状態 |
|---------|------|------|
| Phase 1〜5（現在） | 書き込み処理なし | ✅ 禁止継続 |
| Phase 6 | Googleカレンダー ReadOnly のみ | 書き込みなし予定 |
| 将来（未定） | Gmail 下書き作成（送信なし・社長承認必須） | **要別途承認** |
| 永久禁止 | 金額・契約・謝罪・事故の自動送信 | ❌ 実装しない |

---

## Phase 5.1 追加安全確認

| チェック項目 | 状態 |
|------------|------|
| 新規外部サービス追加 | ❌ なし（既存構造の強化のみ） |
| 書き込み API 追加 | ❌ なし |
| スコープ追加 | ❌ なし（gmail.readonly のみ継続） |
| client_secret のフロントエンド露出 | ❌ なし（SPA のため使用禁止、.env.example に記載のみ） |
| .env の Git コミット | ❌ なし（.gitignore で除外済み） |
| SPA OAuth リスク文書化 | ✅ OAUTH_SECURITY_REVIEW.md・README に記載 |
| 接続前チェック UI | ✅ Settings.tsx に追加 |
| Google Cloud Console 手順書 | ✅ GOOGLE_CONNECT_CHECKLIST.md として作成 |

---

## 安全設計の原則（全フェーズ共通）

1. **書き込み禁止**: Gmail への書き込み API（送信・返信・削除等）は実装しない
2. **スコープ最小化**: 必要最小限のスコープのみ要求する
3. **人間承認**: AI が生成した返信案は社長が確認・手動送信するまで送信されない
4. **自動送信禁止**: 金額・契約・謝罪・事故に関する内容は自動送信しない
5. **ローカルのみ**: 取得データはクライアントのローカルにのみ保存
6. **APIキー保護**: 認証情報をコードにハードコードしない（`.env` で管理）
7. **SPA リスク周知**: client_secret 不使用・localStorage リスク・本番化前のバックエンドプロキシ推奨を文書化
