# 外部設定 承認依頼（1回で完了する集約版・Codex検収用詳細）

対象: Gmailリアルタイム（Pub/Sub **Pull**方式・公開HTTPS不要）＋LINE WORKSリアルタイム（Cloud Run最小中継）
コード・テスト・スクリプトは完成済み。以下の**外部環境への変更**のみ、坂本社長の承認と操作が必要です。
承認までは GCP / Cloud Run / IAM / Secret Manager / LINE WORKS Console へ一切変更を加えません。

---

## 1. 対象プロジェクト

| 項目 | 値 |
|---|---|
| GCP project ID | `lcc-command` |
| GCP project number | **未取得**（既存SAは最小権限のため読取403で取得不可。`scripts/gcloud-setup-realtime.ps1` が実行冒頭で `gcloud projects describe` により表示し、承認証跡として記録する） |
| Cloud Run region | `asia-northeast1`（東京。日本リージョン固定） |
| 既存SA（変更なし・流用） | `lcc-command-ai@lcc-command.iam.gserviceaccount.com`（Sheets/Drive読取に使用中） |

## 2. 作成するリソース（全リスト・これ以外は作らない）

| 種別 | 名前 | 用途 |
|---|---|---|
| API有効化 | `gmail.googleapis.com` | Gmail watch / history 読取 |
| API有効化 | `pubsub.googleapis.com` | イベント通知の受け渡し |
| API有効化 | `run.googleapis.com` | LINE WORKS中継の実行基盤 |
| API有効化 | `secretmanager.googleapis.com` | Bot Secretの安全な保管 |
| API有効化 | `cloudbuild.googleapis.com` | `gcloud run deploy --source` がコンテナをビルドするため（必須） |
| API有効化 | `artifactregistry.googleapis.com` | ビルドしたコンテナイメージの保存先（必須） |
| Pub/Sub topic | `lcc-gmail-events` | Gmail新着通知（historyIdのみ・本文なし） |
| Pub/Sub topic | `lcc-lineworks-events` | LINE WORKS検証済みイベント |
| Pub/Sub subscription | `lcc-gmail-events-pull` | LAN内PCがPull購読（ack-deadline 60s） |
| Pub/Sub subscription | `lcc-lineworks-events-pull` | 同上 |
| Service Account（新規・runtime） | `lcc-lineworks-relay@lcc-command.iam.gserviceaccount.com` | relay実行専用（Secret読取+topic発行+outbox書込のみ） |
| Service Account（新規・build） | `lcc-build@lcc-command.iam.gserviceaccount.com` | **専用build SA**。`--build-service-account`で明示し、既定Compute/Cloud Build SAへ依存しない |
| Secret | `lineworks-bot-secret` | LINE WORKS Bot Secret（署名検証用。一時ファイル経由登録+HMAC自己検査） |
| GCS bucket（新規・耐久outbox） | `lcc-command-lineworks-outbox` | **LINE WORKSはCallback失敗時に再送しないため**、Pub/Sub publish失敗イベント（内部再試行後）の退避先。LCC側drainが必ず取り込む |
| Cloud Run service | `lcc-lineworks-relay` | 公開エンドポイント1本のみ（`POST /lineworks/callback`）・max 2 instances・256Mi |
| Artifact Registry repository（自動作成・共有扱い） | `cloud-run-source-deploy`（asia-northeast1） | `--source` deploy時にgcloudが自動作成。**teardownで丸ごと削除しない**（relayイメージのみ削除） |
| Cloud Storage bucket（自動作成・共有扱い） | Cloud Buildソースアップロード用（gcloud既定名） | **teardownで削除しない** |

**役割分離（deployer / build / runtime）**:
- **deployer**: setup scriptを実行する社長のgcloudアカウント（preflightでowner/editor権限と対象projectを確認し、不足時は変更前に停止）
- **build**: `lcc-build@…`（専用SA。下記project-level 3ロールのみ。既定SAの広い権限に依存しない）
- **runtime**: `lcc-lineworks-relay@…`（リソース単位権限のみ）
- **公開設定**: `--allow-unauthenticated` は **`allUsers` へ `roles/run.invoker`** を付与する（このサービス1本のみ）。Webhook受口のため必須。アプリ層でBot ID許可+HMAC署名検証を行い、未署名リクエストは処理しない。

## 3. IAM差分（現在 → 追加後）

**現在**: 既存SA `lcc-command-ai@…` にプロジェクトレベルのロール付与は**なし**（Sheets/Driveはファイル共有ベースの読取のみ。Cloud Resource Manager読取が403になることを実測確認済み）。

**追加するproject-levelロール（3件・専用build SAに必要。「0件」ではない＝隠さず明記）**:

| # | メンバー | ロール（project-level） | 必要な理由 |
|---|---|---|---|
| P1 | `lcc-build@lcc-command.iam.gserviceaccount.com`（新規build SA） | `roles/logging.logWriter` | Cloud Buildのビルドログ書込に必須 |
| P2 | 同上 | `roles/artifactregistry.createOnPushWriter` | ビルド済みイメージのpush（`cloud-run-source-deploy` repoの自動作成含む）に必須 |
| P3 | 同上 | `roles/storage.objectViewer` | `--source`アップロード先bucketからソースを読むために必須 |

（既定Compute SA / Cloud Build SAの広い既定ロールへ依存しないための分離。teardownで3件とも解除する）

**追加するリソース単位の権限**:

| # | メンバー | ロール | 対象リソース | 必要な理由 |
|---|---|---|---|---|
| 1 | `gmail-api-push@system.gserviceaccount.com`（Google管理の公式システムSA） | `roles/pubsub.publisher` | topic `lcc-gmail-events` のみ | Gmail APIが新着通知（historyId）をこのtopicへ発行するため。Google公式手順の必須設定。読取権限は持たない |
| 2 | `lcc-command-ai@lcc-command.iam.gserviceaccount.com`（既存SA） | `roles/pubsub.subscriber` | subscription `lcc-gmail-events-pull` のみ | LAN内PCが通知をPull受信するため。topicへの発行権・管理権・他subscriptionの購読権は付与しない |
| 3 | 同上 | `roles/pubsub.subscriber` | subscription `lcc-lineworks-events-pull` のみ | 同上（LINE WORKS側） |
| 4 | 同上 | `roles/storage.objectAdmin` | bucket `lcc-command-lineworks-outbox` のみ | outbox drain（読取+取込成功後の削除）のため |
| 5 | `lcc-lineworks-relay@…`（runtime SA） | `roles/secretmanager.secretAccessor` | secret `lineworks-bot-secret` のみ | relayがWebhook署名（HMAC）を検証するため。他のSecretへはアクセス不可 |
| 6 | 同上 | `roles/pubsub.publisher` | topic `lcc-lineworks-events` のみ | 署名検証済みイベントの発行のみ。購読権・Gmail側topicへの権限なし |
| 7 | 同上 | `roles/storage.objectCreator` | bucket `lcc-command-lineworks-outbox` のみ | publish失敗イベントの退避書込のみ（読取・削除は不可） |
| 8 | `allUsers` | `roles/run.invoker` | Cloud Run service `lcc-lineworks-relay` のみ | LINE WORKSのWebhookが未認証HTTPSで届くため公開が必須（`--allow-unauthenticated` の実体）。アプリ層でBot ID許可+HMAC署名検証を行い、未署名リクエストは受理しない。解除は `gcloud-teardown-realtime.ps1 -StopOnly` |

`scripts/gcloud-setup-realtime.ps1` はpreflight（対象project・実行者権限の確認。不足時は変更前に停止）→計画/IAM差分表示→**`yes` 明示入力**の順で、`-PlanOnly` は表示のみ。冪等（既存はskip・途中失敗から再実行可）で、作成分は `data/gcloud-setup-receipt.json` へ記録します。削除・rollbackは `scripts/gcloud-teardown-realtime.ps1`（同じく `-PlanOnly`+`yes` 必須・receipt記載の自作リソースのみ削除・共有repo/bucket保護）。

## 4. Gmail OAuth

| 項目 | 値 |
|---|---|
| 対象アカウント | `sakamoto55@lcc55.com`（このアカウント1つのみ） |
| scope | `https://www.googleapis.com/auth/gmail.readonly` **のみ**（読取専用。送信・削除・ラベル変更の権限なし） |
| クライアント種別 | デスクトップ型OAuthクライアント（社長がGCP Consoleで作成） |
| domain-wide delegation | **使用しない**。SAによるユーザー成り代わりは行わず、社長本人のブラウザ承認1回のみ |
| token保管 | PC内 `secure/`（ACL制限・Git管理外・ログ非出力）。取消はGoogleアカウントの「サードパーティアクセス」からいつでも可能 |

## 5. データの通り道と保持期間

**Gmail**: Pub/Sub通知には**本文が含まれない**（historyIdのみ）。本文メタデータはLAN内PCがGmail APIから直接取得し、PC内JSONL（`%LOCALAPPDATA%\LCC_COMMAND\data\intelligence\`・Git管理外）に保存。クラウド側に本文は残らない。

**LINE WORKS本文の経路**:
1. LINE WORKS → Cloud Run relay（**メモリ内処理のみ**。本文をログ・ディスクに書かない。ログは理由コードのみ）
2. relay → Pub/Sub topic `lcc-lineworks-events`（Google管理の保存時暗号化）
3. LAN内PC がPull受信 → PC内JSONLへ永続化 → ACK（**ACK後はPub/Subから削除される**）

| 保持 | 期間 |
|---|---|
| Pub/Sub message retention（未ACK分） | **7日**（subscription設定 `--message-retention-duration 7d`。PCが7日以上停止すると未取得分は失われる＝運用上の既知制約） |
| ACK済みメッセージ | Pub/Sub上に**残らない**（即削除） |
| クラウド側dead-letter | **作らない**（クラウド保持を増やさない方針）。処理5回失敗のメッセージはPC内 `deadletter.jsonl` へ隔離保存しACK（内容保全・詰まり防止） |
| Cloud Run relay | ステートレス。ディスク・DB・ログへの本文保存なし |

## 6. 概算費用（月額）

| サービス | 無料枠 | 想定利用 | 概算 |
|---|---|---|---|
| Cloud Run | 200万リクエスト/月・360,000 GB秒 | LINE WORKSメッセージ数百〜数千件/月・min-instances 0 | **¥0**（無料枠内） |
| Cloud Build | 120ビルド分/日 | deploy時のみ（1ビルド数分・日常利用なし） | **¥0** |
| Artifact Registry | ストレージ0.5GBまで無料 | relayイメージ1つ（数十〜200MB程度） | **¥0**（超過時 約$0.10/GB/月） |
| Cloud Storage | 5GB無料枠 | ソースアップロード（deploy時のみ数MB）+ 耐久outbox（publish障害時のみ・通常0件） | **¥0** |
| Pub/Sub | 10GB/月 | 数MB/月 | **¥0** |
| Secret Manager | 6 secret versions・10,000アクセス/月 | 1 secret・起動時アクセスのみ | **¥0** |
| Gmail API | 無料（クォータ制） | 通知駆動の差分取得のみ | **¥0** |

課金が発生する条件: 上記無料枠の超過時のみ。`--max-instances 2` により異常トラフィック時もCloud Runの上限が制限される。再deployを繰り返すとArtifact Registryに旧イメージが蓄積するため、不要イメージは削除する（手順は§7）。想定合計: **月¥0〜100未満**。

## 7. 停止・削除・ロールバック手順（全て可逆）

**停止手順（この順で。teardownスクリプトがWindows PowerShellで実行可能な形で提供）**:
1. LINE WORKS Developer ConsoleでBot Callback URLを削除（送信元を止める）
2. `scripts\gcloud-teardown-realtime.ps1 -ProjectId lcc-command -StopOnly`（allUsers→run.invoker解除。`-PlanOnly`で事前確認可）
3. `npm run gmail:authorize -- --stop`（users.stop。token・メールへの影響なし）
4. `stop-lcc-command.bat`（server+subscriber停止）

**完全削除・rollback**:
```
scripts\gcloud-teardown-realtime.ps1 -ProjectId lcc-command -PlanOnly   # 削除計画の確認（変更なし）
scripts\gcloud-teardown-realtime.ps1 -ProjectId lcc-command             # yes入力後に実削除
```
- `data/gcloud-setup-receipt.json`（setupが記録した**作成リソースreceipt**）に記載の自作リソースのみ削除
- **共有リソースは削除しない**: Artifact Registry repo `cloud-run-source-deploy` は保護（relayイメージのみ削除）・Cloud Build用bucketは保護
- build SAのproject-level 3ロールも解除
- Gmail OAuth取消は手動: https://myaccount.google.com/permissions → 該当クライアント削除 + PCのtokenファイル削除

既存SA `lcc-command-ai@…` への追加はsubscription 2件+outbox bucketのみのため、これらの削除で権限も消滅する。

## 8. 外部送信機能が存在しないことの保証

- relay（`cloudrun/lcc-lineworks-relay/`）にLINE WORKSへの**送信コードは存在しない**（受信・検証・Pub/Sub発行のみ。全コードはZIP内で検収可能）
- Gmailは `gmail.readonly` のため**送信・返信・転送・削除が権限上不可能**
- LCC COMMAND本体の外部自動返信は従来どおり存在しない（下書き生成まで）
- LCC COMMAND本体・8787番ポート・LAN内PCは**外部公開しない**（Cloudflare Tunnel等は不使用。公開されるのはrelayの `POST /lineworks/callback` 1本のみ）

## 9. 社長の操作（承認後・この順で・約15分）

1. [GCP Console] デスクトップ型OAuthクライアントを作成 → client id/secretを `.env` の `GMAIL_CLIENT_ID/SECRET` へ
2. PowerShellで `scripts\gcloud-setup-realtime.ps1 -ProjectId lcc-command -LccSaEmail lcc-command-ai@lcc-command.iam.gserviceaccount.com -LineworksBotId <BotID>` を実行
   → **実行計画とIAM差分が表示され、`yes` 入力後にのみ変更**（Bot Secretは非表示入力。画面・ログ・Gitへ出ない）
3. 表示されたrelay URL + `/lineworks/callback` をLINE WORKS Developer ConsoleのBot Callback URLへ登録
4. PCで `npm run gmail:authorize` → ブラウザで1回承認（readonly scopeのみの同意画面）
5. `npm run check:realtime` が全PRESENTになったら「設定done」と一言 → 実着信テスト（§6実受入試験8種）を実測

## 10. 変更しないもの（再掲・保証）

- 実着信を確認するまで Gmail / LINE WORKS を LIVE_API・リアルタイム接続完了とは報告しない
- Secret・OAuth token・メール本文・LINE WORKS本文を検収ZIP・ログ・Gitへ含めない
- 本資料の承認（Codex確認後の一括承認）までは、上記リソースを一切作成しない
