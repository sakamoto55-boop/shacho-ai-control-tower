# PHASE11_GMAIL_PRODUCTION_CONNECT.md — Gmail ReadOnly 本番接続 設計書

> Phase 11 — Gmail 実データ接続（読み取り専用）  
> 2026-06-27

---

## 目的

AI社長室 v1.0.0 MVP を、デモデータから実データ運用へ移行する第一段階として、  
**Google OAuth + Gmail ReadOnly の本番接続**を行う。

- 接続対象は **Gmail のみ**
- Calendar / Drive / Sheets / LINE WORKS はデモのまま（本番接続しない）
- 送信・返信・下書き・削除・既読化・ラベル変更は実装しない（永久禁止）

---

## 接続範囲

| サービス | Phase 11 | データ元 | スコープ |
|---------|---------|---------|---------|
| Gmail | ✅ 本番接続 | Gmail API（接続時）/ mockGmail（未接続時）| `gmail.readonly` |
| Calendar | ❌ デモ | mockCalendar | — |
| Drive | ❌ デモ | mockDrive | — |
| Sheets | ❌ デモ | mockSheets | — |
| LINE WORKS | ❌ デモ | mockLineworks | — |

---

## OAuth フロー（Authorization Code + PKCE）

```
設定画面「Googleアカウントで接続（Gmail ReadOnly のみ）」
   ↓ googleAuth.startOAuthFlow()
   ↓ PKCE: code_verifier → SHA256 → code_challenge / state（CSRF対策）
   ↓ scope = gmail.readonly のみ（PHASE11_SCOPES）
Google 認証画面（accounts.google.com）
   ↓ ユーザーが gmail.readonly に同意
アプリへリダイレクト（?code=...&state=...）
   ↓ App.tsx が検知 → googleAuth.handleCallback()
   ↓ state 検証 → トークン交換（oauth2.googleapis.com/token）
   ↓ userinfo でメール確認 → googleToken.save()
設定画面「✓ 接続済み」
```

---

## Gmail 取得仕様

| 項目 | 値 |
|------|-----|
| クエリ | `is:unread newer_than:1d`（未読・過去24時間）|
| 最大件数 | 20件（詳細取得は最大10件並列）|
| 取得項目 | 送信者 / 件名 / 日時 / 本文スニペット / 添付有無 / 未読フラグ / ラベル |
| HTTPメソッド | GET のみ |
| キャッシュ | 5分TTL（localStorage）|

### データフロー（接続時）

```
googleToken.hasToken() = true
   ↓
gmailClient.fetchRawMessages()
   ├── gmailCache.get()（5分以内ならキャッシュ）
   └── gmailFetcher.fetchMessages(accessToken)
         GET /gmail/v1/users/me/messages?q=is:unread newer_than:1d
         GET /gmail/v1/users/me/messages/{id}?format=full（並列最大10件）
   ↓ GmailMessage[]（writeProtected: true）
gmailCache.set()
   ↓ mapToGmailDerivedTask / createGmailSummary
AIコックピット Inbox セクション（本番Gmail接続バッジ）
```

---

## 変更ファイル

### サービス層

| ファイル | 変更 |
|---------|------|
| `gmailFetcher.ts` | DEFAULT_QUERY を `newer_than:3d` → `newer_than:1d`（過去24時間）|
| `gmailClient.ts` | `getConnectionStatus()` を実接続状態（connected/itemCount）反映に修正 |
| `gmail/types.ts` | `GmailConnectionStatus.connected` を `boolean` に・`itemCount` 追加 |
| `googleScopes.ts` | `PHASE11_SCOPES`（gmail.readonly のみ）追加 |
| `googleAuth.ts` | OAuth フローを `PHASE11_SCOPES` 使用に変更 |
| `client/.env.example` | `VITE_GOOGLE_SCOPES` を gmail.readonly のみに整理 |

### 画面

| ファイル | 変更 |
|---------|------|
| `Settings.tsx` | Gmail読み取りテストを実接続反映（本番/デモ・取得件数・最終取得）· 接続ボタン文言を「Gmail ReadOnly のみ」|
| `CockpitScreen.tsx` | 接続時に実Gmailへ切替（gmailSource: demo/api）· 本番Gmail接続バッジ |

---

## 安全設計

- スコープは `gmail.readonly` のみ。`FORBIDDEN_SCOPES`（send/modify/compose 等）は使用しない
- `gmailFetcher.ts` は GET のみ。POST/PATCH/PUT/DELETE は OAuth トークン交換以外に存在しない
- 書き込み関数（sendMessage / replyMessage / createDraft / deleteMessage / archiveMessage / markAsRead / modifyLabels / addStar）は未実装
- `client_secret` はフロントエンドに置かない（SPA では使用しない）
- `client/.env` は `.gitignore` で除外
- 取得したメールは表示・AI判定用のみ。外部書き込みなし

---

## 未実装（Phase 12 以降）

- Calendar / Drive / Sheets の本番接続
- LINE WORKS 本番接続（バックエンドProxy必須）
- バックエンドProxy経由のトークン管理（XSS対策強化）
- Gmail 下書き作成（送信なし・人間承認必須）
