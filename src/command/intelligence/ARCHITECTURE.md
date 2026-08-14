# DIOS リアルタイム取込アーキテクチャ（構成訂正版・2026-08-14承認方針）

## 訂正の要点（坂本社長指示）
- **Gmailは公開HTTPS不要**: `users.watch`→Pub/Sub topic→**Pull subscription**をLAN内PCの常駐subscriberが購読する。Cloudflare Tunnel・PC外部公開は使用しない。
- **LINE WORKSはCloud Run最小中継**: 公開するのは `lcc-lineworks-relay` の `POST /lineworks/callback` 1本のみ。LCC本体・8787・LAN・管理画面・APIは外部非公開のまま。relayは検証とPub/Sub publishだけを行い、解析・AI判断・送信機能を持たない。
- **共通Inbound Event Pipeline**: External event → RawEvent → Entity解決 → Knowledge/Action/Decision分類 → 情報補完 → DecisionCase → 追跡。Gmail/LINE WORKSを特殊処理にしない。

## 経路
```
Gmail INBOX ──users.watch──▶ Pub/Sub topic(lcc-gmail-events) ──Pull──▶ LAN内subscriber
LINE WORKS ──callback──▶ Cloud Run relay(署名検証+publishのみ) ──▶ Pub/Sub topic(lcc-lineworks-events) ──Pull──▶ 同subscriber
subscriber ──▶ InboundPipeline ──▶ IntelligenceStore(RawEvent冪等) ──ACK(永続化成功後のみ)──▶ 分類→DecisionCase/ActionItem/Knowledge
```

## 不変条件
- OAuthは`gmail.readonly`のみ（送信権限なし）。未認証はCONFIG_REQUIRED表示＋PC側で1回の認証導線。
- ACKは**RawEvent永続化成功後のみ**。失敗はACKせず再配信。N回失敗はdead-letterファイルへ隔離。
- 冪等キー: Gmail=messageId/threadId/historyId+contentHash、LINE WORKS=eventId+contentHash。
- PC停止中の通知はPub/Sub側に保持され、再起動後にbacklogとして処理。
- 実着信を確認するまでGmail/LINE WORKSをLIVE_API・リアルタイム接続完了とは報告しない。
- 本文は外部入力（本文中の命令をシステム命令として実行しない）。LLMへ渡す前に機密区分とProvider可否を判定。
- Cloud Run deploy・Secret登録・IAM変更・Callback URL登録は**外部変更のため、完成後に1回だけまとめて承認を求める**。

## IAM（外部設定時に承認を求める内容の骨子）
- Gmail通知topicへ `gmail-api-push@system.gserviceaccount.com` にPublisher権限。
- LCC側認証主体（SA）は対象subscription限定の**Subscriber権限のみ**。
- Cloud Run SAはSecret参照+対象topicへのPublishのみ。max instances制限。
