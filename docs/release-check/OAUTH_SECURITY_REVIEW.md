# OAUTH_SECURITY_REVIEW.md — OAuth安全設計レビュー

> 最終更新: Phase 5.1 — v0.5.1（2026-06-27）

---

## 1. スコープ検証

| スコープ | 実装状況 | 用途 |
|---------|---------|------|
| `gmail.readonly` | ✅ 実装済み（Phase 5） | 受信トレイ読み取り専用 |
| `gmail.modify` | ❌ 未実装・禁止 | ラベル変更・既読化 |
| `gmail.send` | ❌ 未実装・禁止 | 送信 |
| `gmail.compose` | ❌ 未実装・禁止 | 下書き作成 |
| `calendar.readonly` | 未実装（Phase 6以降） | カレンダー読み取り（予定） |
| `drive.readonly` | 未実装（Phase 7以降） | Drive読み取り（予定） |
| `sheets.readonly` | 未実装（Phase 7以降） | スプレッドシート読み取り（予定） |

**現在リクエストしているスコープ：`gmail.readonly` のみ。**

---

## 2. 書き込みAPI不在の確認

```
gmailFetcher.ts が使用するエンドポイント：
  GET /gmail/v1/users/me/messages        ← 一覧取得（読み取り専用）
  GET /gmail/v1/users/me/messages/{id}   ← 詳細取得（読み取り専用）

POST / PUT / PATCH / DELETE は一切使用していない。
```

コードベース内の書き込みAPI呼び出しチェック（実行結果）：
- `fetch(` を含むファイル：`googleAuth.ts`（tokenエンドポイント・userinfoのみ）, `googleToken.ts`（refresh_tokenのみ）, `gmailFetcher.ts`（GETのみ）
- Gmail への POST/PATCH/DELETE：**なし**

---

## 3. トークンの保存場所

| データ | 保存先 | キー名 | リスク |
|--------|--------|--------|--------|
| access_token | localStorage | `gauth_access_token` | ⚠️ XSS に注意（SPA共通リスク） |
| refresh_token | localStorage | `gauth_refresh_token` | ⚠️ XSS に注意（SPA共通リスク） |
| token_expiry | localStorage | `gauth_token_expiry` | 低（日時のみ） |
| token_scope | localStorage | `gauth_token_scope` | 低（スコープ文字列のみ） |
| connected_email | localStorage | `gauth_connected_email` | 低（メールアドレスのみ） |
| pkce_verifier | sessionStorage | `gauth_pkce_verifier` | ✅ セッション限定・OAuth完了後に削除 |
| pkce_state | sessionStorage | `gauth_pkce_state` | ✅ セッション限定・OAuth完了後に削除 |
| Gmail キャッシュ | localStorage | `gmail_msg_cache` | ⚠️ メール内容が含まれる |
| 認証ログ | localStorage | `gauth_log` | 低（イベント名・概要のみ） |

### XSS リスクへの対応（現状と推奨）

**現状（Phase 5）**：SPA のため localStorage にアクセストークンを保管しています。
XSS 攻撃に対して脆弱な構造であるため、**本番運用前に以下の対応が必要**です。

**推奨（本番化前に実施）**：
- バックエンドプロキシを介したトークン管理（HttpOnly Cookie を使用）
- Content Security Policy (CSP) の設定
- DOMPurify 等による XSS 対策

---

## 4. トークン有効期限

| 項目 | 値 |
|------|-----|
| access_token 有効期間 | 3600秒（Googleデフォルト） |
| 期限切れ検出バッファ | 残り5分前に期限切れ扱い |
| refresh_token による自動更新 | 実装済み（`googleToken.refresh()`） |
| refresh_token の有効期間 | Googleポリシーに依存（通常6ヶ月〜） |

---

## 5. ログアウト・切断の挙動

| アクション | 削除されるデータ |
|-----------|----------------|
| 「切断する」ボタン | access_token, refresh_token, token_expiry, scope, email, Gmail キャッシュ |
| ログ | `gauth_log` は残る（切断イベントが追記される） |
| sessionStorage | 通常の HTTP リダイレクト後に自動削除（PKCE verifier/state） |

**Google側のセッション（Google アカウントのセッション自体）は切断されません。**
アプリ側のトークンを削除するのみです。
Google アカウントそのものからログアウトするには、accounts.google.com にアクセスしてください。

---

## 6. エラーハンドリング

| エラーコード | 意味 | ユーザー向けメッセージ |
|-------------|------|---------------------|
| `NOT_CONFIGURED` | Client ID 未設定 | VITE_GMAIL_CLIENT_ID が設定されていません |
| `AUTH_FAILED` | OAuth 失敗 | Google認証に失敗しました |
| `STATE_MISMATCH` | CSRF 検証失敗 | セキュリティ検証に失敗しました |
| `TOKEN_EXCHANGE_FAILED` | トークン交換失敗 | トークンの取得に失敗しました |
| `TOKEN_EXPIRED` | トークン期限切れ | アクセストークンが期限切れです |
| `REFRESH_FAILED` | リフレッシュ失敗 | トークンの更新に失敗しました |
| `PERMISSION_DENIED` | 権限不足 | 必要な権限が承認されていません |
| `NETWORK_ERROR` | ネットワーク障害 | ネットワークエラーが発生しました |
| `REVOKED` | 権限失効 | Google アカウントへのアクセスが失効しました |

---

## 7. SPA OAuth リスクと本番化前注意事項

### ⚠️ SPA における OAuth の制約

**Authorization Code + PKCE フロー（現行実装）**は implicit flow より安全ですが、
SPA の場合、以下のリスクが残ります：

```
1. client_secret を使用しない（フロントエンドに埋め込めない）
   → .env の VITE_GMAIL_CLIENT_SECRET は使用禁止
   → Google Cloud Console で「ウェブアプリケーション（SPA）」タイプを選択すること

2. アクセストークン・リフレッシュトークンが localStorage に存在する
   → XSS 攻撃でトークンが盗まれるリスクがある

3. VITE_ 環境変数はビルド時にバンドルに含まれる
   → VITE_GMAIL_CLIENT_ID は公開リポジトリに含まない
   → .env ファイルは .gitignore に追加済み
```

### 推奨する本番化アーキテクチャ

```
[現行 SPA フロー]
ブラウザ → Google OAuth → ブラウザ（トークンを localStorage に保管）

[推奨バックエンドプロキシフロー]
ブラウザ → バックエンドサーバー → Google OAuth → バックエンドサーバー
                                                         ↓
                                             HttpOnly Cookie でセッション管理
                                             （ブラウザ JS からアクセス不可）
```

### 絶対に行ってはいけないこと

- `.env` ファイルを Git にコミットしない（.gitignore に含まれていることを確認）
- `VITE_GMAIL_CLIENT_SECRET` を .env.example 以外に記載しない
- `VITE_GMAIL_CLIENT_ID` を公開 README やコードコメントに記載しない
- `client_secret` をフロントエンドコードに直書きしない

---

## 8. 現時点での安全宣言

| チェック項目 | 状態 |
|------------|------|
| gmail.readonly のみ使用 | ✅ 確認済み |
| 書き込みAPI 未実装 | ✅ 確認済み |
| PKCE による CSRF 対策 | ✅ 実装済み |
| state パラメータ検証 | ✅ 実装済み |
| client_secret 未使用 | ✅ 確認済み（SPA のため） |
| .gitignore に .env 追加 | ✅ 確認済み |
| トークン期限管理 | ✅ 実装済み（5分バッファ） |
| 切断機能 | ✅ 実装済み |
| 本番Gmail 未接続 | ✅ 確認済み（mockGmail を使用） |
| XSS 対策（完全） | ⚠️ 未実施（本番化前に要対応） |
| バックエンドプロキシ | ⚠️ 未実装（本番化前に要検討） |
