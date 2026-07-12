# Google OAuth 設定ガイド — Phase 11（Gmail ReadOnly 本番接続）

> このガイドは、AI社長室で **Gmail の実データ（読み取り専用）** を表示するための  
> Google Cloud Console 設定手順です。  
> Phase 11 で接続するのは **Gmail のみ**。Calendar / Drive / Sheets は対象外です。

---

## 接続範囲（Phase 11）

| サービス | 接続 | スコープ |
|---------|------|---------|
| Gmail | ✅ 本番接続 | `gmail.readonly`（読み取り専用）|
| Calendar | ❌ 未接続（デモ）| — |
| Drive | ❌ 未接続（デモ）| — |
| Sheets | ❌ 未接続（デモ）| — |
| LINE WORKS | ❌ 未接続（デモ・バックエンド必須）| — |

> ⚠️ 送信・返信・下書き作成・削除・既読化・ラベル変更は実装していません（永久に禁止）。

---

## Step 1: Google Cloud プロジェクトを作成

1. [Google Cloud Console](https://console.cloud.google.com/) を開く
2. 上部のプロジェクト選択 →「新しいプロジェクト」
3. プロジェクト名: `AI社長室` → 作成

---

## Step 2: Gmail API を有効化

1. 左メニュー「APIとサービス」→「ライブラリ」
2. 「Gmail API」を検索 → 開く →「有効にする」

> Phase 11 では **Gmail API のみ** 有効化します。Calendar/Drive/Sheets API は有効化不要です。

---

## Step 3: OAuth 同意画面を設定

1. 「APIとサービス」→「OAuth同意画面」
2. User Type:
   - 社内のみ（Google Workspace）→ **内部**
   - 個人 Gmail を使う → **外部**
3. アプリ情報:
   - アプリ名: `AI社長室`
   - ユーザーサポートメール: `sakamoto55@lcc55.com`
   - デベロッパー連絡先: `sakamoto55@lcc55.com`
4. スコープ:
   - 「スコープを追加または削除」→ `.../auth/gmail.readonly` を選択
   - **書き込みスコープ（gmail.send / gmail.modify / gmail.compose）は絶対に選ばない**
5. テストユーザー（User Type が「外部」の場合）:
   - 社長の Gmail アドレスを「テストユーザー」に追加
   - ※ テスト中は登録したユーザーのみログイン可能

---

## Step 4: OAuth クライアント ID を作成

1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」
2. アプリケーションの種類: **ウェブアプリケーション**
3. 名前: `AI社長室 Web`

### 承認済みの JavaScript 生成元

```
http://localhost:5173
https://sakamoto55-boop.github.io
```

### 承認済みのリダイレクト URI

```
http://localhost:5173/
https://sakamoto55-boop.github.io/shacho-ai-control-tower/
```

> ⚠️ リダイレクト URI は `client/.env` の `VITE_GOOGLE_REDIRECT_URI` と**完全一致**させてください（末尾の `/` も含む）。

4. 「作成」→ 表示された **クライアント ID** をコピー

> **クライアントシークレットは使いません**（SPA では使用不可）。フロントエンドには絶対に置かないでください。

---

## Step 5: 環境変数を設定

`client/.env.example` をコピーして `client/.env` を作成：

```bash
cp client/.env.example client/.env
```

`client/.env` を編集：

```env
VITE_GOOGLE_CLIENT_ID=<Step4でコピーしたクライアントID>
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
VITE_GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly
```

> ⚠️ `client/.env` は `.gitignore` で除外されており、GitHub にコミットされません。

---

## Step 6: 接続テスト

1. `cd client && npm run dev`
2. ブラウザで `http://localhost:5173/` を開く
3. 「設定」→「Googleアカウントで接続（Gmail ReadOnly のみ）」をタップ
4. Google ログイン → `gmail.readonly` に同意
5. 設定画面に「✓ 接続済み」が表示される
6. 「Gmail読み取りテスト」→「📥 読み取りテスト」で実メールが取得できることを確認

---

## 本番公開前の注意点

| 項目 | 内容 |
|------|------|
| クライアントシークレット | SPA では使用しない。フロントエンドに置かない |
| トークン保管 | 現状は localStorage（XSSリスクあり）。本番強化はバックエンドProxy（Phase 12+）|
| OAuth同意画面の公開 | 「外部」の場合、テスト中は登録ユーザーのみ。一般公開には Google 審査が必要 |
| スコープ | `gmail.readonly` のみ。審査対象スコープのため、用途説明が必要な場合あり |
| リダイレクトURI | 本番 URL を Console に登録し、`.env` と一致させる |
| 書き込み | 一切実装しない。送信・返信・削除・既読化なし |

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| `redirect_uri_mismatch` | Console のリダイレクトURIと `.env` の値が不一致。末尾 `/` を確認 |
| `access_blocked` | OAuth同意画面のテストユーザーに自分を追加 |
| `invalid_client` | `VITE_GOOGLE_CLIENT_ID` の値が誤り |
| メール0件 | 過去24時間に未読メールがない（`is:unread newer_than:1d`）|
| トークン期限切れ | 設定画面で一度「切断」→再接続 |
