# SAFETY_REPORT.md — 外部API接続状況・安全設計確認書

> 最終更新: Phase 5 — v0.5.0（2026-06-27）  
> このファイルは外部API接続・書き込み処理の有無を確認するための文書です。

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

## 安全設計の原則（全フェーズ共通）

1. **書き込み禁止**: Gmail への書き込み API（送信・返信・削除等）は実装しない
2. **スコープ最小化**: 必要最小限のスコープのみ要求する
3. **人間承認**: AI が生成した返信案は社長が確認・手動送信するまで送信されない
4. **自動送信禁止**: 金額・契約・謝罪・事故に関する内容は自動送信しない
5. **ローカルのみ**: 取得データはクライアントのローカルにのみ保存
6. **APIキー保護**: 認証情報をコードにハードコードしない（`.env` で管理）
