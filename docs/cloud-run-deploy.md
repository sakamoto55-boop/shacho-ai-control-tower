# Cloud Runへのデプロイ手順（スマホからいつでも確認したい場合）

このドキュメントは、`/dev/console` を社長がスマホからいつでも開けるように、
インターネット上（Google Cloud Run）に公開するための手順です。

Phase 1の方針として、この手順は**必要になったときだけ**進めてください。
実際にコマンドを実行する作業はパソコンが必要です（スマホだけではできません）。

## 重要な注意点（先に読んでください）

- **費用が発生する可能性があります**。Cloud Runには無料枠がありますが、
  GCPプロジェクトの作成にはクレジットカード等の請求先情報の登録が必須です。
  低頻度の利用であれば無料枠内に収まることがほとんどですが、念のため
  GCPコンソールで予算アラートを設定することをおすすめします。
- **保存したデータ（AI受信箱・タスク・返信下書き）は消える可能性があります**。
  `STORAGE_DRIVER=local` のままCloud Runにデプロイすると、保存先はコンテナ内の
  一時ファイルになり、再起動やスケールのたびに消えます。「保存しないで見るだけ」
  （AI分析する（保存しない）ボタン）であれば影響ありません。保存したデータを
  失いたくない場合は、先にデータベース接続（将来のkintone接続等）を検討してください。

## ステップ0：GCPプロジェクトがあるか確認する

1. パソコンまたはスマホのブラウザで https://console.cloud.google.com/ を開く
2. 会社のGoogleアカウントでログインする
3. 画面上部のプロジェクト選択のドロップダウンを開く
   - 何もプロジェクトが表示されない・請求先の登録を求められる → **まだ無い**（ステップ1へ）
   - 既存のプロジェクトが一覧に表示される → **すでにある**（ステップ2へ、そのプロジェクトIDを使う）

## ステップ1：GCPプロジェクトを新規作成する（まだ無い場合）

1. https://console.cloud.google.com/ で「プロジェクトを作成」
2. プロジェクト名を入力（例：`shacho-ai-control-tower`）
3. 請求先アカウントを設定（クレジットカード等の登録が必要）
4. 作成されたプロジェクトIDを控えておく（以降 `PROJECT_ID` として使います）

## ステップ2：パソコンでデプロイ準備をする

1. [Google Cloud CLI（gcloud）](https://cloud.google.com/sdk/docs/install) をパソコンにインストール
2. ターミナルで以下を実行してログイン

   ```bash
   gcloud auth login
   gcloud config set project PROJECT_ID
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com
   ```

## ステップ3：デプロイする

このリポジトリのルートディレクトリで実行します。`CONSOLE_ACCESS_KEY` は
第三者にURLを知られてもアクセスされないようにするための秘密のキーです。
好きな文字列（推測されにくいもの）に置き換えてください。

```bash
gcloud run deploy shacho-ai-control-tower \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars ENABLE_DEV_ENDPOINTS=true,AI_PROVIDER=mock,STORAGE_DRIVER=local,CONSOLE_ACCESS_KEY=ここに秘密のキーを入れる
```

デプロイが完了すると、`https://shacho-ai-control-tower-xxxxx-an.a.run.app` のような
URLが表示されます。

## ステップ4：スマホで開く

デプロイ完了後に表示されたURLの末尾に `/dev/console?key=秘密のキー` を付けて開きます。

```
https://shacho-ai-control-tower-xxxxx-an.a.run.app/dev/console?key=ここに秘密のキー
```

このURLをスマホのホーム画面に追加しておくと、アプリのようにワンタップで開けます。

## 再デプロイ（コードを更新したとき）

ステップ3のコマンドをもう一度実行するだけです。
