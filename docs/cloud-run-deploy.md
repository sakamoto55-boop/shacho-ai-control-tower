# Cloud Runへのデプロイ手順（スマホからいつでも確認したい場合）

このドキュメントは、`/dev/console` を社長がスマホからいつでも開けるように、
インターネット上（Google Cloud Run）に公開するための手順です。

Phase 1の方針として、この手順は**必要になったときだけ**進めてください。
実際にコマンドを実行する作業はパソコンが必要です（スマホだけではできません。
特にGoogleアカウントのログインをやり直す作業は、スマホのCloud Shellだと
認証コードのコピーがうまくいかず失敗しやすいので、必ずパソコンのブラウザで
行ってください）。

## 現在の進捗（2026-07-04時点）

- GCPプロジェクト：`lcc-morning-report`（組織: `lcc55.com`, 組織ID: `498916191164`）
- Cloud Runサービスは**デプロイ済み**：`https://shacho-ai-control-tower-laxdn4yz3q-an.a.run.app`
  （ブランチ `claude/company-operations-team-81933y` から `--source .` でビルド）
- 合言葉（`CONSOLE_ACCESS_KEY`）: `88e2fe5104e7fc4f`
- **残作業**：会社の組織ポリシー（Domain Restricted Sharing）が「誰でもアクセス可」設定を
  ブロックしているため、まだ403 Forbiddenで開けない。下記「組織ポリシーでブロックされた場合」
  の手順を、**パソコンのブラウザ**でCloud Shellを開いて実行すれば解決する見込み。

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

## 組織ポリシーでブロックされた場合（`FAILED_PRECONDITION` / 403 Forbidden）

`--allow-unauthenticated` でデプロイしても、会社のGoogle Cloud組織に
「Domain Restricted Sharing」という制限がかかっていると、実際には
`allUsers`（誰でもアクセス可）を設定できず、URLを開くと
`Error: Forbidden` になることがある。以下のエラーが出た場合はこれが原因。

```
ERROR: (gcloud.run.services.add-iam-policy-binding) FAILED_PRECONDITION:
One or more users named in the policy do not belong to a permitted customer,
perhaps due to an organization policy.
```

対処：このプロジェクトだけ組織ポリシーの例外を設定する。
**必ずパソコンのブラウザでCloud Shellを開いて**、以下を順番に実行する
（`ORG_ID` は `gcloud organizations list` で確認できる。lcc55.comの場合は `498916191164`）。

```bash
# 1. 組織ポリシーを変更する権限を自分に付与（組織の管理者のみ実行可能）
gcloud organizations add-iam-policy-binding ORG_ID \
  --member="user:自分のメールアドレス" \
  --role="roles/orgpolicy.policyAdmin"

# 2. Organization Policy APIを有効化
gcloud services enable orgpolicy.googleapis.com

# 3. このプロジェクトだけ「allUsers」を許可する例外ポリシーを設定
cat > /tmp/policy.yaml << 'EOF'
name: projects/PROJECT_ID/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
EOF
gcloud org-policies set-policy /tmp/policy.yaml

# 4. あらためて公開設定
gcloud run services add-iam-policy-binding SERVICE_NAME \
  --region=REGION \
  --member=allUsers \
  --role=roles/run.invoker \
  --condition=None

# 5. 確認（allUsers / roles/run.invoker が表示されればOK）
gcloud run services get-iam-policy SERVICE_NAME --region=REGION
```

### ハマりやすいポイント

- IAMポリシーの変更コマンドは、既存の条件付きバインディングがあると
  「[1]/[2]/[3]から選んでください」という対話プロンプトが出ることがある。
  `--condition=None` を必ず付けて対話を回避する。
- Cloud Shellは長時間放置したり、スマホアプリ経由で使うと認証が切れて
  `You do not currently have an active account selected` になることがある。
  その場合はCloud Shellを再起動するか、`gcloud auth login` をやり直す
  （やり直す際は確認コードだけを貼り付け、他のコマンドと混ぜて貼り付けない）。
- `gcloud organizations add-iam-policy-binding` は、実行するアカウントが
  組織の管理者（`roles/resourcemanager.organizationAdmin`）である必要がある。
  持っていない場合は `gcloud organizations get-iam-policy ORG_ID` で
  誰が管理者か確認し、その人に依頼する。
