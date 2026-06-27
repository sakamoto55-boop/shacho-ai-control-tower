# PRODUCTION_SECURITY_CHECK.md — 本番接続セキュリティ確認書

> Phase 11 — Gmail ReadOnly 本番接続前後のセキュリティ確認  
> 2026-06-27

---

## 1. 秘密情報のリポジトリ混入チェック

| チェック項目 | コマンド | 結果 |
|------------|---------|------|
| `.env` がコミットされていない | `git ls-files \| grep -E '\.env$'` | ✅ なし（.env.example のみ）|
| `.gitignore` に `.env` 系がある | `grep env .gitignore` | ✅ `.env` / `.env.*` / `!.env.example` |
| `client/.env` が無視される | `git check-ignore client/.env` | ✅ 無視される |
| 実APIキー混入（AIza/GOCSPX/ya29/BEGIN）| `git grep -E 'AIza...\|GOCSPX-\|ya29\.'` | ✅ 検出なし |
| README/docs に実キーなし | 目視 + grep | ✅ プレースホルダのみ |

---

## 2. 公開リポジトリ状態の確認

| 項目 | 状態 |
|------|------|
| リポジトリ公開設定 | public（GitHub Pages 無料利用のため）|
| 公開されるもの | ソースコード・デモ用モックデータ |
| 公開されないもの | `client/.env`（gitignore）· トークン · クライアントシークレット |
| トークン保管場所 | ブラウザ localStorage（端末内のみ・リポジトリに含まれない）|

> ⚠️ public リポジトリのため、`client_secret` や実トークンを**コード/`.env.example`/README に絶対に書かない**こと。

---

## 3. スコープ確認

| 項目 | 値 |
|------|-----|
| 要求スコープ（Phase 11）| `https://www.googleapis.com/auth/gmail.readonly` のみ |
| OAuth フロー使用定数 | `PHASE11_SCOPES`（googleScopes.ts）|
| 禁止スコープ | `gmail.send` / `gmail.modify` / `gmail.compose` / `mail.google.com` / `calendar` / `drive` / `spreadsheets`（FORBIDDEN_SCOPES）|
| Calendar/Drive/Sheets スコープ | Phase 11 では要求しない |

---

## 4. 書き込みAPI不存在の確認

以下の関数が**存在しないこと**を確認（`git grep` で検出ゼロ）:

| 禁止関数 | 状態 |
|---------|------|
| `sendMessage` | ❌ 未実装 |
| `replyMessage` | ❌ 未実装 |
| `createDraft` | ❌ 未実装 |
| `deleteMessage` | ❌ 未実装 |
| `archiveMessage` | ❌ 未実装 |
| `markAsRead` | ❌ 未実装 |
| `modifyLabels` | ❌ 未実装 |
| `addStar` | ❌ 未実装 |

### HTTPメソッド確認

`client/src/services/gmail/` `client/src/services/google/` 配下の POST は  
**OAuth トークン交換・リフレッシュのみ**（`oauth2.googleapis.com/token`）。  
Gmail データに対する POST/PATCH/PUT/DELETE は存在しない。

---

## 5. トークン・認証情報の取り扱い

| 項目 | 実装 |
|------|------|
| client_secret | SPA では使用しない（フロントエンドに含めない）|
| PKCE | code_verifier を sessionStorage に保存・トークン交換後に削除 |
| state | CSRF対策として検証 |
| access_token / refresh_token | localStorage 保管（端末内）|
| 本番強化案 | バックエンドProxy + HttpOnly Cookie（Phase 12 以降）|

---

## 6. 残存リスクと対応方針

| リスク | 現状 | 対応方針 |
|--------|------|---------|
| localStorage の XSS トークン窃取 | 残存 | Phase 12 でバックエンドProxy化 |
| OAuth同意画面 未審査 | テストユーザーのみ | 一般利用時に Google 審査 |
| public リポジトリ | コード公開 | 秘密情報は `.env`（gitignore）で分離済み |

---

## 確認結論

```
Phase 11 時点:
✅ 秘密情報のリポジトリ混入なし
✅ スコープは gmail.readonly のみ
✅ 書き込みAPI・書き込み関数は未実装
✅ client_secret はフロントエンドに存在しない
✅ 取得データは表示・AI判定用のみ（外部書き込みなし）
```

最終確認日: 2026-06-27
