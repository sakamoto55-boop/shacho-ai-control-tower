# Gmail連携の認証情報を取得する手順

`src/connectors/gmail.ts` の `GmailApiConnector` を有効にするために必要な
3つの値（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`）を
取得する手順です。スマホのブラウザだけで完結できます（Cloud Shellは使いません）。

## 重要な注意点

- ここで取得する情報は「会社のGmailを読む鍵」です。`.env`や環境変数として保管し、
  コードには書き込まない、他人に教えない、チャットに貼り付けたままにしない
  よう注意してください。
- 対象は「読み取り専用」スコープ（`gmail.readonly`）だけにします。AIによる
  自動送信は作らない、というCLAUDE.mdの方針を守るためです。

## ステップ1：Gmail APIを有効化する

1. ブラウザで以下を開く（プロジェクトは`lcc-morning-report`のまま）

   ```
   https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=lcc-morning-report
   ```

2. 「有効にする」をタップ

## ステップ2：OAuth同意画面を設定する

1. 以下を開く

   ```
   https://console.cloud.google.com/auth/overview?project=lcc-morning-report
   ```

2. アプリ名（例：`社長AI管制塔`）、サポートメール（`sakamoto55@lcc55.com`）を入力
3. **ユーザータイプは「内部（Internal）」を選択**してください。Google Workspace
   （`lcc55.com`）のドメイン内だけで使う設定にすることで、Googleによる
   アプリ審査（数日〜数週間かかることがある）が不要になります。
4. 保存

## ステップ3：OAuthクライアントIDを作成する

1. 以下を開く

   ```
   https://console.cloud.google.com/auth/clients?project=lcc-morning-report
   ```

2. 「認証情報を作成」→「OAuthクライアントID」
3. アプリケーションの種類：**「デスクトップ アプリ」** を選択（一番シンプルです）
4. 名前は任意（例：`gmail-connector`）
5. 作成すると、**クライアントID**と**クライアントシークレット**が表示されます。
   この2つをメモしてください（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` になります）。

## ステップ4：リフレッシュトークンを取得する

パソコンが使える場合は、リポジトリ同梱のスクリプトを使う方法が確実です（推奨）。
OAuth 2.0 Playgroundは「Use your own OAuth credentials」の設定が反映されず、
Google共通の初期クライアントで認証してしまうことがあり、その場合Cloud Run側で
認証エラーになります。

### 方法A：ローカルスクリプトを使う（推奨、パソコンが必要）

1. このリポジトリをパソコンにclone（または既にある場合はそのまま）
2. ターミナルで以下を実行（`<CLIENT_ID>` `<CLIENT_SECRET>` はステップ3で取得した値に置き換える）

   ```bash
   node scripts/get-gmail-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
   ```

3. 表示されたURLをブラウザで開き、監視したいGmailアカウントでログイン・許可
4. 許可すると自動的にターミナルに `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
   `GOOGLE_REFRESH_TOKEN` の3行が表示されるので、そのまま次のステップ5で使う

### 方法B：OAuth 2.0 Playgroundを使う（パソコンが無い場合）

1. ブラウザで以下を開く

   ```
   https://developers.google.com/oauthplayground/
   ```

2. 画面右上の歯車アイコン（設定）をタップ
3. **「Use your own OAuth credentials」**にチェックを入れる
4. `OAuth Client ID` と `OAuth Client secret` に、ステップ3で取得した値を入力
5. 閉じる
6. 左側の「Step 1」の入力欄（Select & authorize APIs）に、直接以下のスコープを入力

   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```

7. 「Authorize APIs」をタップ
8. 会社のGmailアカウント（`sakamoto55@lcc55.com` など、監視したいメールボックス）で
   ログイン・許可
9. **認証後にリダイレクトされたURL、または「リクエスト/レスポンス」に表示されるURLの
   `client_id=`が、ステップ3で作成した自分のクライアントIDと一致しているか必ず確認する**
   （Googleの共通初期値`407408718192...`になっていた場合は、設定がやり直しになります）
10. 「Step 2」の画面で **「Exchange authorization code for tokens」** をタップ
11. 表示された **Refresh token** をコピー（これが `GOOGLE_REFRESH_TOKEN` になります）

## ステップ5：Cloud Runに環境変数を設定する

今日行った「新しいリビジョンの編集とデプロイ」→「変数とシークレット」と同じ手順で、
以下の環境変数を追加してデプロイしてください。

| 名前 | 値 |
|---|---|
| `GOOGLE_CLIENT_ID` | ステップ3のクライアントID |
| `GOOGLE_CLIENT_SECRET` | ステップ3のクライアントシークレット |
| `GOOGLE_REFRESH_TOKEN` | ステップ4のリフレッシュトークン |
| `GMAIL_QUERY` | `newer_than:1d is:important`（任意。空でもデフォルト値が使われます） |

## ステップ6：動作確認する

手入力コンソール（`/dev/console?key=...`）を開き、**「今すぐGmail取得を試す」**
ボタンを押してください。「処理件数」が0より大きければ成功です。

または、Cloud Shellやパソコンから直接確認する場合：

```bash
curl -X POST "https://<CloudRunのURL>/jobs/fetch-messages?key=<CONSOLE_ACCESS_KEYの値>"
```

## 将来的な定期実行（Cloud Scheduler）

`/jobs/fetch-messages` をCloud Schedulerから定期的に（例：15分おき）叩くようにすると、
自動でメールを取り込み続けられます。この設定はGmail連携の動作確認が済んでから
別途行ってください。
