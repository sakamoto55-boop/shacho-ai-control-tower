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
| Pub/Sub topic | `lcc-gmail-events` | Gmail新着通知（historyIdのみ・本文なし） |
| Pub/Sub topic | `lcc-lineworks-events` | LINE WORKS検証済みイベント |
| Pub/Sub subscription | `lcc-gmail-events-pull` | LAN内PCがPull購読（ack-deadline 60s） |
| Pub/Sub subscription | `lcc-lineworks-events-pull` | 同上 |
| Service Account（新規） | `lcc-lineworks-relay@lcc-command.iam.gserviceaccount.com` | relay専用・下記2権限のみ |
| Secret | `lineworks-bot-secret` | LINE WORKS Bot Secret（署名検証用） |
| Cloud Run service | `lcc-lineworks-relay` | 公開エンドポイント1本のみ（`POST /lineworks/callback`）・max 2 instances・256Mi |

## 3. IAM差分（現在 → 追加後）

**現在**: 既存SA `lcc-command-ai@…` にプロジェクトレベルのロール付与は**なし**（Sheets/Driveはファイル共有ベースの読取のみ。Cloud Resource Manager読取が403になることを実測確認済み＝最小権限の証拠）。

**追加する権限（すべてリソース単位。プロジェクトレベルのロール付与は0件）**:

| # | メンバー | ロール | 対象リソース | 必要な理由 |
|---|---|---|---|---|
| 1 | `gmail-api-push@system.gserviceaccount.com`（Google管理の公式システムSA） | `roles/pubsub.publisher` | topic `lcc-gmail-events` のみ | Gmail APIが新着通知（historyId）をこのtopicへ発行するため。Google公式手順の必須設定。読取権限は持たない |
| 2 | `lcc-command-ai@lcc-command.iam.gserviceaccount.com`（既存SA） | `roles/pubsub.subscriber` | subscription `lcc-gmail-events-pull` のみ | LAN内PCが通知をPull受信するため。topicへの発行権・管理権・他subscriptionの購読権は付与しない |
| 3 | 同上 | `roles/pubsub.subscriber` | subscription `lcc-lineworks-events-pull` のみ | 同上（LINE WORKS側） |
| 4 | `lcc-lineworks-relay@…`（新規SA） | `roles/secretmanager.secretAccessor` | secret `lineworks-bot-secret` のみ | relayがWebhook署名（HMAC）を検証するため。他のSecretへはアクセス不可 |
| 5 | 同上 | `roles/pubsub.publisher` | topic `lcc-lineworks-events` のみ | 署名検証済みイベントの発行のみ。購読権・Gmail側topicへの権限なし |

`scripts/gcloud-setup-realtime.ps1` は実行前にこの差分と作成対象を画面表示し、**`yes` の明示入力がない限り一切変更しません**（`-PlanOnly` で表示のみも可能）。

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
| Pub/Sub | 10GB/月 | 数MB/月 | **¥0** |
| Secret Manager | 6 secret versions・10,000アクセス/月 | 1 secret・起動時アクセスのみ | **¥0** |
| Gmail API | 無料（クォータ制） | 通知駆動の差分取得のみ | **¥0** |

課金が発生する条件: 上記無料枠の超過時のみ。`--max-instances 2` により異常トラフィック時もCloud Runの上限が制限される。想定合計: **月¥0〜100未満**。

## 7. 停止・削除・ロールバック手順（全て可逆）

```
# 即時停止（受信を止める）
gcloud run services update lcc-lineworks-relay --region asia-northeast1 --max-instances 0   # relay停止
# LINE WORKS ConsoleでCallback URLを削除（送信元を止める）
# PC側: stop-lcc-command.bat（subscriberも停止）／ npm run gmail:authorize -- --stop でwatch解除（users.stop）

# 完全削除（作成したものを全て消す）
gcloud run services delete lcc-lineworks-relay --region asia-northeast1
gcloud pubsub subscriptions delete lcc-gmail-events-pull lcc-lineworks-events-pull
gcloud pubsub topics delete lcc-gmail-events lcc-lineworks-events
gcloud secrets delete lineworks-bot-secret
gcloud iam service-accounts delete lcc-lineworks-relay@lcc-command.iam.gserviceaccount.com
gcloud services disable gmail.googleapis.com run.googleapis.com secretmanager.googleapis.com  # 必要なら
# Gmail OAuth取消: https://myaccount.google.com/permissions → 該当クライアントを削除、PCのtokenファイル削除
```

既存SA `lcc-command-ai@…` への追加は subscription 2件のSubscriberのみのため、subscription削除で権限も消滅する。

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
