# =============================================================================
# LCC COMMAND リアルタイム連携 Google Cloud設定スクリプト（構成訂正版）
# 実行は坂本社長承認後に1回だけ。実行前に EXTERNAL_SETUP_APPROVAL.md を確認してください。
# 前提: gcloud CLIログイン済み・請求有効なプロジェクト
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$LccSaEmail,      # 例: lcc-command@<project>.iam.gserviceaccount.com（既存Sheets/Drive SA）
  [Parameter(Mandatory = $true)][string]$LineworksBotId,
  [string]$Region = "asia-northeast1"
)
$ErrorActionPreference = "Stop"

Write-Host "== 1. API有効化 =="
gcloud services enable gmail.googleapis.com pubsub.googleapis.com run.googleapis.com secretmanager.googleapis.com --project $ProjectId

Write-Host "== 2. Pub/Sub topics =="
gcloud pubsub topics create lcc-gmail-events --project $ProjectId
gcloud pubsub topics create lcc-lineworks-events --project $ProjectId

Write-Host "== 3. Gmail push権限（Google側システムSAへPublisher付与） =="
gcloud pubsub topics add-iam-policy-binding lcc-gmail-events --project $ProjectId `
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" --role="roles/pubsub.publisher"

Write-Host "== 4. Pull subscriptions（LCC側SAはSubscriberのみ・対象限定） =="
gcloud pubsub subscriptions create lcc-gmail-events-pull --topic lcc-gmail-events --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
gcloud pubsub subscriptions create lcc-lineworks-events-pull --topic lcc-lineworks-events --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
gcloud pubsub subscriptions add-iam-policy-binding lcc-gmail-events-pull --project $ProjectId `
  --member="serviceAccount:$LccSaEmail" --role="roles/pubsub.subscriber"
gcloud pubsub subscriptions add-iam-policy-binding lcc-lineworks-events-pull --project $ProjectId `
  --member="serviceAccount:$LccSaEmail" --role="roles/pubsub.subscriber"

Write-Host "== 5. Bot Secret（値は対話入力・画面へ出さない） =="
$sec = Read-Host -AsSecureString "LINE WORKS Bot Secretを入力"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
$plain | gcloud secrets create lineworks-bot-secret --project $ProjectId --data-file=-
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $plain = $null

Write-Host "== 6. relay用SA（Secret参照+対象topic Publishのみ） =="
gcloud iam service-accounts create lcc-lineworks-relay --project $ProjectId --display-name "LCC LINE WORKS relay"
$relaySa = "lcc-lineworks-relay@$ProjectId.iam.gserviceaccount.com"
gcloud secrets add-iam-policy-binding lineworks-bot-secret --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/secretmanager.secretAccessor"
gcloud pubsub topics add-iam-policy-binding lcc-lineworks-events --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/pubsub.publisher"

Write-Host "== 7. Cloud Run deploy（最小構成・max instances制限・未認証呼出可=Webhook受口） =="
gcloud run deploy lcc-lineworks-relay --project $ProjectId --region $Region `
  --source "$PSScriptRoot\..\cloudrun\lcc-lineworks-relay" `
  --service-account $relaySa `
  --allow-unauthenticated `
  --max-instances 2 --memory 256Mi --cpu 1 `
  --set-env-vars "PUBSUB_TOPIC=projects/$ProjectId/topics/lcc-lineworks-events,LINEWORKS_ALLOWED_BOT_IDS=$LineworksBotId" `
  --set-secrets "LINEWORKS_BOT_SECRET=lineworks-bot-secret:latest"

Write-Host "== 完了。表示されたURL + /lineworks/callback をLINE WORKS Developer ConsoleのBot Callback URLへ登録してください =="
