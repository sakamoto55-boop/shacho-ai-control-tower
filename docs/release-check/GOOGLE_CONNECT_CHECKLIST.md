# GOOGLE_CONNECT_CHECKLIST.md — Google Cloud Console 設定チェックリスト

> 最終更新: Phase 5.1 — v0.5.1（2026-06-27）  
> 本番接続前に以下の手順を完了してください。

---

## 前提条件

- [ ] Google アカウントを所持している
- [ ] Google Cloud Console（https://console.cloud.google.com/）にアクセスできる

---

## Step 1: プロジェクト作成

- [ ] Google Cloud Console にログイン
- [ ] 「新しいプロジェクト」を作成
  - プロジェクト名例：`shacho-ai-control-tower`
- [ ] 作成したプロジェクトを選択

---

## Step 2: Gmail API を有効化

- [ ] 左メニュー「APIとサービス」→「ライブラリ」を開く
- [ ] 検索欄で「Gmail API」を検索
- [ ] 「Gmail API」をクリック→「有効にする」

---

## Step 3: OAuth 同意画面の設定

- [ ] 左メニュー「APIとサービス」→「OAuth 同意画面」を開く
- [ ] ユーザータイプを「外部」または「内部」に設定
  - 内部：Google Workspace ドメイン限定（推奨）
  - 外部：誰でも接続可能（テスト段階ではテストユーザーのみ）
- [ ] アプリ名を入力（例：`AI社長室`）
- [ ] サポートメール・デベロッパーメールを入力
- [ ] 「保存して次へ」

### スコープ設定
- [ ] 「スコープを追加または削除」をクリック
- [ ] 以下のスコープのみ追加：
  ```
  https://www.googleapis.com/auth/gmail.readonly
  ```
- [ ] **以下のスコープは追加しない（書き込み禁止）**：
  - `gmail.modify`
  - `gmail.send`
  - `gmail.compose`
  - `gmail.labels`
  - `mail.google.com`
- [ ] 「保存して次へ」

### テストユーザー（外部の場合）
- [ ] 「テストユーザーを追加」に自分のGmailアドレスを追加
- [ ] 「保存して次へ」

---

## Step 4: OAuth 2.0 クライアントIDの作成

- [ ] 左メニュー「APIとサービス」→「認証情報」を開く
- [ ] 「認証情報を作成」→「OAuth 2.0 クライアント ID」を選択
- [ ] アプリケーションの種類：**「ウェブ アプリケーション」** を選択
  - ⚠️ 「デスクトップ アプリ」や「iOS/Android」は選ばない
- [ ] 名前を入力（例：`AI社長室 SPA`）
- [ ] 「承認済みの JavaScript 生成元」に以下を追加：
  ```
  http://localhost:5173
  ```
  （本番デプロイ時は本番URLも追加）
- [ ] 「承認済みのリダイレクト URI」に以下を追加：
  ```
  http://localhost:5173/
  ```
  （末尾スラッシュに注意。本番デプロイ時は本番URLも追加）
- [ ] 「作成」をクリック
- [ ] **クライアントID（`*.apps.googleusercontent.com`）をコピー**
  - ⚠️ クライアントシークレットはSPAでは使用しない（フロントエンドに含めない）

---

## Step 5: 環境変数の設定

- [ ] `client/.env` ファイルを作成（`.gitignore` に含まれていることを確認）
- [ ] 以下を記入：

```env
# Gmail / Calendar / Drive 共通 Client ID（Phase 6以降は1つで全サービス対応）
VITE_GOOGLE_CLIENT_ID=取得したクライアントID.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
# Phase 6時点のスコープ（gmail.readonly + calendar.readonly）
VITE_GOOGLE_SCOPES=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly
```

- [ ] `client_secret` は **設定しない**（SPAでは不要・セキュリティリスク）
- [ ] `.env` を Git に追加していないことを確認（`git status` で確認）

---

## Step 6: 接続前チェック（アプリ内）

- [ ] `npm run dev` でアプリを起動
- [ ] 設定画面 → 「Google アカウント連携」セクションを開く
- [ ] 接続前チェックパネルを確認：
  - Client ID設定：✅ 設定済み
  - Redirect URI設定：✅ 設定済み
  - スコープ：✅ gmail.readonly のみ
  - 書き込みAPI：✅ 未実装
  - 本番接続準備：✅ 完了

---

## Step 7: 接続テスト

- [ ] 「Googleアカウントで接続」ボタンをタップ
- [ ] Google ログイン画面が開く
- [ ] テストユーザーでログイン（外部アプリの場合）
- [ ] 「Gmail の読み取り」を承認
- [ ] アプリに戻り「✓ 接続済み」バッジが表示される
- [ ] 接続したGmailアドレスが表示される
- [ ] 認証ログに `oauth_success` が記録されている

---

## Step 8: 安全確認

- [ ] Gmail に新しいメールが届いていない
- [ ] Gmail の未読状態が変わっていない
- [ ] Gmail のラベルが変わっていない
- [ ] Gmailアプリで「アカウントへのアクセス権」を確認（accounts.google.com → セキュリティ → アカウントにアクセスできるアプリ）
  - `gmail.readonly` スコープのみが表示されていることを確認

---

## 注意事項

### 公開リポジトリへのコミット禁止

```
❌ 絶対にコミットしてはいけないファイル：
  client/.env
  client/.env.local
  client/.env.production

✅ コミットして良いファイル：
  client/.env.example（認証情報を含まないサンプルのみ）
```

### 本番化前に必要な追加対応

1. **HTTPS の使用**：本番環境では必ず HTTPS を使用する
2. **本番 Redirect URI の登録**：Google Cloud Console に本番 URL を追加
3. **OAuth 同意画面の本番申請**：外部ユーザー向けの場合は Google の確認・承認が必要
4. **バックエンドプロキシの検討**：セキュリティ強化のため（OAUTH_SECURITY_REVIEW.md 参照）
5. **CSP（Content Security Policy）の設定**：XSS 対策
