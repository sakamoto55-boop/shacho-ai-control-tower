# =============================================================================
# LCC COMMAND リアルタイム連携 Google Cloud設定スクリプト（計画表示→明示確認方式）
# - 実行は坂本社長承認後に1回だけ。詳細は EXTERNAL_SETUP_APPROVAL.md を参照。
# - 実行前に「作成対象リソース」と「IAM差分」を表示し、`yes` の明示入力がない限り一切変更しない。
# - -PlanOnly を付けると表示のみで終了する（外部変更ゼロ）。
# 前提: gcloud CLIログイン済み・請求有効なプロジェクト
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$LccSaEmail,      # 例: lcc-command-ai@lcc-command.iam.gserviceaccount.com（既存Sheets/Drive SA）
  [Parameter(Mandatory = $true)][string]$LineworksBotId,
  [string]$Region = "asia-northeast1",                     # 東京（日本リージョン固定）
  [switch]$PlanOnly
)
$ErrorActionPreference = "Stop"
$relaySa = "lcc-lineworks-relay@$ProjectId.iam.gserviceaccount.com"

# --- Phase 0: プロジェクト確認（読み取りのみ）と実行計画の表示 --------------
Write-Host "== 対象プロジェクト（gcloud projects describe・読み取りのみ） =="
gcloud projects describe $ProjectId --format="table(projectId,projectNumber,lifecycleState)"

Write-Host ""
Write-Host "== 実行計画（この内容以外は変更しません。--source deployの自動作成分も含め全て明記） =="
Write-Host "  [作成] API有効化: gmail / pubsub / run / secretmanager / cloudbuild / artifactregistry"
Write-Host "  [作成] Pub/Sub topic: lcc-gmail-events, lcc-lineworks-events"
Write-Host "  [作成] Pub/Sub subscription: lcc-gmail-events-pull, lcc-lineworks-events-pull (ack 60s / retention 7d)"
Write-Host "  [作成] Service Account: $relaySa"
Write-Host "  [作成] Secret: lineworks-bot-secret（値は非表示入力・画面/ログ非出力）"
Write-Host "  [作成] Cloud Run: lcc-lineworks-relay（region=$Region, max-instances=2, 256Mi, 公開POST 1本のみ）"
Write-Host "  [自動作成] Artifact Registry repo: cloud-run-source-deploy（$Region）+ relayイメージ lcc-lineworks-relay"
Write-Host "  [自動作成] Cloud Build用ソースアップロードbucket（gcloud既定名）"
Write-Host "  [前提] ビルドはGoogle自動作成のCloud Build用SA（<projectNumber>-compute@developer / cloudbuild）が実行"
Write-Host ""
Write-Host "== IAM差分（リソース単位のみ・プロジェクトレベルの新規付与は0件） =="
Write-Host "  [追加] gmail-api-push@system.gserviceaccount.com -> roles/pubsub.publisher @ topic lcc-gmail-events"
Write-Host "  [追加] $LccSaEmail -> roles/pubsub.subscriber @ subscription lcc-gmail-events-pull"
Write-Host "  [追加] $LccSaEmail -> roles/pubsub.subscriber @ subscription lcc-lineworks-events-pull"
Write-Host "  [追加] $relaySa -> roles/secretmanager.secretAccessor @ secret lineworks-bot-secret"
Write-Host "  [追加] $relaySa -> roles/pubsub.publisher @ topic lcc-lineworks-events"
Write-Host "  [追加] allUsers -> roles/run.invoker @ Cloud Run lcc-lineworks-relay（--allow-unauthenticatedの実体。Webhook受口）"
Write-Host ""

if ($PlanOnly) {
  Write-Host "-PlanOnly のため表示のみで終了します（外部変更なし）"
  exit 0
}

$confirm = Read-Host "上記をすべて確認しました。実行する場合は yes と入力してください"
if ($confirm -ne "yes") {
  Write-Host "中止しました（外部変更なし）"
  exit 1
}

# --- Phase 1: API有効化（--source deployが要するcloudbuild/artifactregistryを含む） ---
Write-Host "== 1. API有効化 =="
gcloud services enable gmail.googleapis.com pubsub.googleapis.com run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $ProjectId

# --- Phase 2: Pub/Sub topics -------------------------------------------------
Write-Host "== 2. Pub/Sub topics =="
gcloud pubsub topics create lcc-gmail-events --project $ProjectId
gcloud pubsub topics create lcc-lineworks-events --project $ProjectId

# --- Phase 3: Gmail push権限（Google管理システムSAへ対象topicのPublisherのみ） -
Write-Host "== 3. Gmail push権限 =="
gcloud pubsub topics add-iam-policy-binding lcc-gmail-events --project $ProjectId `
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" --role="roles/pubsub.publisher"

# --- Phase 4: Pull subscriptions（LCC側SAはSubscriberのみ・対象限定） ---------
Write-Host "== 4. Pull subscriptions =="
gcloud pubsub subscriptions create lcc-gmail-events-pull --topic lcc-gmail-events --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
gcloud pubsub subscriptions create lcc-lineworks-events-pull --topic lcc-lineworks-events --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
gcloud pubsub subscriptions add-iam-policy-binding lcc-gmail-events-pull --project $ProjectId `
  --member="serviceAccount:$LccSaEmail" --role="roles/pubsub.subscriber"
gcloud pubsub subscriptions add-iam-policy-binding lcc-lineworks-events-pull --project $ProjectId `
  --member="serviceAccount:$LccSaEmail" --role="roles/pubsub.subscriber"

# --- Phase 5: Bot Secret（値は対話入力・画面へ出さない） ----------------------
Write-Host "== 5. Bot Secret =="
$sec = Read-Host -AsSecureString "LINE WORKS Bot Secretを入力"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
$plain | gcloud secrets create lineworks-bot-secret --project $ProjectId --data-file=-
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $plain = $null

# --- Phase 6: relay用SA（Secret参照+対象topic Publishのみ） -------------------
Write-Host "== 6. relay用SA =="
gcloud iam service-accounts create lcc-lineworks-relay --project $ProjectId --display-name "LCC LINE WORKS relay"
gcloud secrets add-iam-policy-binding lineworks-bot-secret --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/secretmanager.secretAccessor"
gcloud pubsub topics add-iam-policy-binding lcc-lineworks-events --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/pubsub.publisher"

# --- Phase 7: Cloud Run deploy（最小構成・Webhook受口のみ公開） ---------------
Write-Host "== 7. Cloud Run deploy =="
gcloud run deploy lcc-lineworks-relay --project $ProjectId --region $Region `
  --source "$PSScriptRoot\..\cloudrun\lcc-lineworks-relay" `
  --service-account $relaySa `
  --allow-unauthenticated `
  --max-instances 2 --memory 256Mi --cpu 1 `
  --set-env-vars "PUBSUB_TOPIC=projects/$ProjectId/topics/lcc-lineworks-events,LINEWORKS_ALLOWED_BOT_IDS=$LineworksBotId" `
  --set-secrets "LINEWORKS_BOT_SECRET=lineworks-bot-secret:latest"

Write-Host "== 完了。表示されたURL + /lineworks/callback をLINE WORKS Developer ConsoleのBot Callback URLへ登録してください =="
Write-Host "== ロールバック手順は EXTERNAL_SETUP_APPROVAL.md §7 =="
