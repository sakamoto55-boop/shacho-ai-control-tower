# 外部設定 承認依頼（1回で完了する集約版）

対象: Gmailリアルタイム（Pub/Sub Pull）＋LINE WORKSリアルタイム（Cloud Run relay）
コード・テスト・スクリプトは完成済み。以下の**外部環境への変更**のみ、坂本社長の承認と操作が必要です。
（承認いただければ、私が実行できる部分はスクリプトで自動化済み。小分けの確認はしません）

## 承認対象の変更内容（全リスト）
1. **Google Cloud APIの有効化**: gmail / pubsub / run / secretmanager（課金対象はCloud Run微小・Pub/Sub微小）
2. **Pub/Sub topic作成**: `lcc-gmail-events` / `lcc-lineworks-events`
3. **IAM変更（最小権限）**:
   - `gmail-api-push@system.gserviceaccount.com` → lcc-gmail-events の **Publisherのみ**
   - 既存LCC SA → 2つのPull subscriptionの **Subscriberのみ**
   - relay専用SA（新規）→ Bot Secret参照 + lcc-lineworks-events Publisher のみ
4. **Secret Manager登録**: LINE WORKS Bot Secret（スクリプトが非表示入力で登録。画面・ログ・Gitへ出ません）
5. **Cloud Run deploy**: `lcc-lineworks-relay`（公開1エンドポイントのみ・UIなし・送信機能なし・max 2 instances）
6. **LINE WORKS Developer Console**: BotのCallback URLへ relayのURL + `/lineworks/callback` を登録
7. **Google OAuth同意**: Gmail読取（gmail.readonly のみ・送信権限なし）をsakamoto55@lcc55.comで1回承認

## 社長の操作（この順で・約15分）
1. [GCP Console] OAuthクライアント（デスクトップ型）を作成 → client id/secretを`.env`の`GMAIL_CLIENT_ID/SECRET`へ（私が安全入力ウィンドウを用意します）
2. PowerShellで: `scripts\gcloud-setup-realtime.ps1 -ProjectId <id> -LccSaEmail <SA> -LineworksBotId <BotID>`（Bot Secretは実行中に非表示入力）
3. 表示されたrelay URLをLINE WORKS ConsoleのCallback URLへ登録
4. PCで `npm run gmail:authorize` → ブラウザで1回承認
5. `npm run check:realtime` が全PRESENTになったら「設定done」と一言ください → 実着信テスト（§6実受入試験）を私が実測します

## 変更しないもの（保証）
- LCC COMMAND本体・8787・LAN・PCは外部公開しません（Cloudflare Tunnel不使用）
- Gmail送信権限は付与しません。LINE WORKSへの送信機能はrelayに存在しません
- 実着信を確認するまでLIVE_API・リアルタイム接続完了とは報告しません
