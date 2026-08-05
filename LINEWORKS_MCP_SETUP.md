# LINE WORKS × Claude カスタムコネクタ セットアップ手順

このリポジトリのAPIサーバーには、claude.ai の「カスタムコネクタ」として登録できる
MCPエンドポイント（`POST /mcp/{トークン}`）が組み込まれています。
登録すると、Claude との会話から直接 LINE WORKS のトークへメッセージを送れるようになります。

```
claude.ai（カスタムコネクタ）
  → このサーバー /mcp/{LINEWORKS_MCP_TOKEN}（MCP Streamable HTTP）
    → LINE WORKS API 2.0（Bot経由でトーク送信）
```

## 安全設計（重要）

- **宛先の許可リスト制**: `LINEWORKS_RECIPIENTS` に登録した相手にしか送信できません。
- **ドライラン既定**: `LINEWORKS_DRY_RUN=true`（既定）の間は実送信せず、送信内容のプレビューだけ返します。
- **URLトークン認証**: `LINEWORKS_MCP_TOKEN` が未設定なら `/mcp` は完全に無効（404）です。
- **社外への自動返信はしない**: このコネクタは社内メンバー・社内トークルームへの連絡用です。
  顧客など社外への返信は従来どおり下書き承認フロー（人間が送信）を守ってください。

## 手順1: LINE WORKS Developer Console でBotとアプリを作る

1. [LINE WORKS Developer Console](https://dev.worksmobile.com/) に管理者アカウントでログイン
2. **API 2.0 のアプリを新規作成** → `Client ID` と `Client Secret` を控える
3. **Service Account を発行** → `xxx@your-domain` 形式のIDを控える
4. **Private Key をダウンロード** → 中身（PEM）を控える
5. OAuth Scope に **`bot`** を追加
6. **Bot を新規登録**（名前は「社長AI管制塔」など）→ `Bot ID` を控える
7. LINE WORKS 管理画面（Admin）でBotを組織に追加し、送信したい相手（例: 竹内さん、平良さん）が
   Botとトークできる状態にする

## 手順2: 宛先のユーザーIDを調べる

送信先メンバーの LINE WORKS アカウントID（`name@your-domain` 形式）を控えます。
管理画面のメンバー一覧で確認できます。

## 手順3: サーバーの環境変数を設定する

`.env`（またはホスティング先の環境変数）に以下を設定します。

```bash
LINEWORKS_CLIENT_ID=（手順1-2）
LINEWORKS_CLIENT_SECRET=（手順1-2）
LINEWORKS_SERVICE_ACCOUNT=（手順1-3）
LINEWORKS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"  # 改行は \n で1行にする
LINEWORKS_BOT_ID=（手順1-6）

# MCPエンドポイントの有効化。長いランダム文字列（URLの一部になる）
# 生成例: openssl rand -hex 32
LINEWORKS_MCP_TOKEN=ここにランダムな文字列

# 送信を許可する宛先（JSON配列を1行で）
LINEWORKS_RECIPIENTS=[{"name":"竹内","type":"user","id":"k.takeuchi@your-domain"},{"name":"平良","type":"user","id":"taira@your-domain"}]

# まずはドライランで動作確認。実送信に切り替えるときだけ false にする
LINEWORKS_DRY_RUN=true
```

`type` は `user`（個別トーク）のほか `channel`（トークルーム。`id` にチャンネルIDを指定）が使えます。

## 手順4: サーバーを公開する（Render Blueprint対応済み）

claude.ai のカスタムコネクタは **公開HTTPSのURL** が必要です。ローカルPCのままでは登録できません。

リポジトリに `render.yaml`（Render Blueprint）を同梱しているので、Renderの無料プランなら以下だけでデプロイできます。

1. [render.com](https://render.com) にGitHubアカウントでサインアップ（無料）
2. ダッシュボードで **「New +」→「Blueprint」** を選択
3. `shacho-ai-control-tower` リポジトリを接続（対象ブランチを選択）
4. 環境変数の入力を求められるので、手順1〜3で控えた値を貼り付ける
5. 「Apply」でデプロイ開始。完了すると `https://shacho-ai-control-tower-xxxx.onrender.com` のようなURLが発行される

`PORT` はRenderが自動注入し、`NODE_ENV=production` により `/dev/*` エンドポイントは自動で無効になります。

※無料プランは15分間アクセスがないとスリープし、次のアクセス時に起動へ数十秒かかります。
　実運用で気になる場合は有料プラン（月$7〜）にすると常時起動になります。

- Railway / Fly.io など他のサービスでも `npm ci --include=dev && npm run build` → `npm start` でデプロイ可能
- 動作検証だけなら: `ngrok http 8787` などのトンネルでも可

公開後、以下で疎通確認できます（`{TOKEN}` は `LINEWORKS_MCP_TOKEN` の値）:

```bash
curl -X POST https://あなたのドメイン/mcp/{TOKEN} \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 手順5: claude.ai にカスタムコネクタとして登録する

1. claude.ai → **設定 → コネクタ**（組織管理者の場合は管理画面のコネクタ設定）
2. **「カスタムコネクタを追加」** を選択
3. 名前: `LINE WORKS`、リモートMCPサーバーURL: `https://あなたのドメイン/mcp/{TOKEN}`
4. 認証は「なし」でOK（URLトークンで保護しているため）
5. 追加後、チャットのコネクタ一覧で LINE WORKS を有効化

## 手順6: 動作確認

Claude とのチャットで:

1. 「LINE WORKSの宛先一覧を見せて」→ `lineworks_list_recipients` が呼ばれ、竹内さん・平良さんが表示される
2. 「竹内さんにテストメッセージを送って」→ ドライランのプレビューが返る
3. 内容に問題なければ `LINEWORKS_DRY_RUN=false` にして再起動 → 実送信が有効になる

## トラブルシューティング

- **トークン取得エラー (400/401)**: Client ID/Secret、Service Account、Private Keyの組み合わせを確認。
  Private Keyの改行が `\n` として正しく入っているかに注意。
- **送信エラー (403)**: OAuth Scopeに `bot` が入っているか、Botが組織に追加済みかを確認。
- **送信エラー (404)**: Bot IDと宛先ユーザーIDを確認。相手がBotとトーク可能な状態かも確認。
- **claude.aiがコネクタを認識しない**: URL末尾のトークンが正しいか、`curl` での疎通確認が通るかを先に確認。
