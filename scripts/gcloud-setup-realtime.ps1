# =============================================================================
# LCC COMMAND リアルタイム連携 Google Cloud設定スクリプト
# - 実行は坂本社長承認後。詳細は EXTERNAL_SETUP_APPROVAL.md を参照。
# - preflight（対象project・実行者権限の確認）→ 計画/IAM差分表示 → `yes` 明示入力 → 実行。
# - 冪等: 既存リソースはskipし、途中失敗から再実行できる。作成分は resource receipt へ記録。
# - -PlanOnly は表示のみ（外部変更ゼロ）。
# - src/command/integrations/gcloud/receipt.ts と同じ規則（テストは tests/command/intelligence/gcloudReceipt.test.ts）。
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
$buildSa = "lcc-build@$ProjectId.iam.gserviceaccount.com"
$outboxBucket = "$ProjectId-lineworks-outbox"
$receiptFile = Join-Path $PSScriptRoot "..\data\gcloud-setup-receipt.json"

function Test-Exists([string[]]$cmdArgs) {
  & gcloud @cmdArgs --project $ProjectId *> $null
  return ($LASTEXITCODE -eq 0)
}

# --- Phase 0a: preflight（読み取りのみ。対象project・実行者・権限を確認し、問題があれば変更前に停止） ---
Write-Host "== preflight（読み取りのみ） =="
$account = (& gcloud config get-value account 2>$null | Select-Object -First 1)
if (-not $account) { Write-Host "STOP: gcloudにログインしていません（gcloud auth login）"; exit 1 }
Write-Host "  実行者: $account"
& gcloud projects describe $ProjectId --format="table(projectId,projectNumber,lifecycleState)"
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: project $ProjectId へアクセスできません（-ProjectId誤りまたは権限不足）"; exit 1 }
$cfgProject = (& gcloud config get-value project 2>$null | Select-Object -First 1)
if ($cfgProject -and $cfgProject -ne $ProjectId) {
  Write-Host "  注意: gcloud既定project($cfgProject)と-ProjectId($ProjectId)が異なります。全コマンドは--project $ProjectId で実行します"
}
$roles = (& gcloud projects get-iam-policy $ProjectId --flatten="bindings[].members" --filter="bindings.members:$account" --format="value(bindings.role)" 2>$null)
Write-Host "  実行者のproject-levelロール: $($roles -join ', ')"
if (-not ($roles -contains 'roles/owner' -or $roles -contains 'roles/editor')) {
  Write-Host "STOP: 実行者に roles/owner または roles/editor がありません。不足権限のまま進めません"
  exit 1
}
if ($account -like "*gserviceaccount.com") {
  Write-Host "STOP: 実行者がservice accountです。人間のdeployerアカウントで実行してください（deployer/build/runtimeの分離）"
  exit 1
}

# --- Phase 0b: 実行計画とIAM差分の表示 ------------------------------------------
Write-Host ""
Write-Host "== 実行計画（この内容以外は変更しません。既存リソースはskip=冪等） =="
Write-Host "  [作成] API有効化: gmail / pubsub / run / secretmanager / cloudbuild / artifactregistry"
Write-Host "  [作成] Pub/Sub topic: lcc-gmail-events, lcc-lineworks-events"
Write-Host "  [作成] Pub/Sub subscription: lcc-gmail-events-pull, lcc-lineworks-events-pull (ack 60s / retention 7d)"
Write-Host "  [作成] Service Account(runtime): $relaySa"
Write-Host "  [作成] Service Account(build): $buildSa（既定Compute/Cloud Build SAへは依存しない）"
Write-Host "  [作成] Secret: lineworks-bot-secret（一時ファイル経由・登録後HMAC自己検査・実値非表示）"
Write-Host "  [作成] GCS bucket(耐久outbox): $outboxBucket（publish失敗イベントの退避先）"
Write-Host "  [作成] Cloud Run: lcc-lineworks-relay（region=$Region, max-instances=2, 256Mi, --build-service-account=$buildSa）"
Write-Host "  [自動作成] Artifact Registry repo: cloud-run-source-deploy（$Region・共有扱い=teardownで削除しない）+ relayイメージ"
Write-Host "  [自動作成] Cloud Build用ソースアップロードbucket（共有扱い=teardownで削除しない）"
Write-Host "  [記録] 作成リソースreceipt: $receiptFile"
Write-Host ""
Write-Host "== IAM差分（役割分離: deployer=$account / build=$buildSa / runtime=$relaySa） =="
Write-Host "  [project-level追加 3件（build SAに必要・隠さず明記）]"
Write-Host "    $buildSa -> roles/logging.logWriter（ビルドログ書込）"
Write-Host "    $buildSa -> roles/artifactregistry.createOnPushWriter（イメージpush・repo自動作成）"
Write-Host "    $buildSa -> roles/storage.objectViewer（ソースアップロードbucketの読取）"
Write-Host "  [リソース単位追加]"
Write-Host "    gmail-api-push@system.gserviceaccount.com -> roles/pubsub.publisher @ topic lcc-gmail-events"
Write-Host "    $LccSaEmail -> roles/pubsub.subscriber @ subscription lcc-gmail-events-pull"
Write-Host "    $LccSaEmail -> roles/pubsub.subscriber @ subscription lcc-lineworks-events-pull"
Write-Host "    $LccSaEmail -> roles/storage.objectAdmin @ bucket $outboxBucket（outbox drain: 読取+削除）"
Write-Host "    $relaySa -> roles/secretmanager.secretAccessor @ secret lineworks-bot-secret"
Write-Host "    $relaySa -> roles/pubsub.publisher @ topic lcc-lineworks-events"
Write-Host "    $relaySa -> roles/storage.objectCreator @ bucket $outboxBucket（outbox書込のみ）"
Write-Host "    allUsers -> roles/run.invoker @ Cloud Run lcc-lineworks-relay（Webhook受口。解除はteardown参照）"
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

$created = New-Object System.Collections.ArrayList

# --- Phase 1: API有効化（冪等） ---------------------------------------------------
Write-Host "== 1. API有効化 =="
gcloud services enable gmail.googleapis.com pubsub.googleapis.com run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $ProjectId

# --- Phase 2: Pub/Sub topics（冪等: 既存はskip） ---------------------------------
Write-Host "== 2. Pub/Sub topics =="
foreach ($t in "lcc-gmail-events", "lcc-lineworks-events") {
  if (Test-Exists @("pubsub", "topics", "describe", $t)) { Write-Host "  skip: topic $t（既存）" }
  else { gcloud pubsub topics create $t --project $ProjectId; [void]$created.Add(@{ kind = "topic"; id = $t }) }
}

# --- Phase 3: Gmail push権限 ------------------------------------------------------
Write-Host "== 3. Gmail push権限 =="
gcloud pubsub topics add-iam-policy-binding lcc-gmail-events --project $ProjectId `
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" --role="roles/pubsub.publisher"

# --- Phase 4: Pull subscriptions（冪等） ------------------------------------------
Write-Host "== 4. Pull subscriptions =="
foreach ($pair in @(@("lcc-gmail-events-pull", "lcc-gmail-events"), @("lcc-lineworks-events-pull", "lcc-lineworks-events"))) {
  $sub = $pair[0]; $topic = $pair[1]
  if (Test-Exists @("pubsub", "subscriptions", "describe", $sub)) { Write-Host "  skip: subscription $sub（既存）" }
  else {
    gcloud pubsub subscriptions create $sub --topic $topic --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
    [void]$created.Add(@{ kind = "subscription"; id = $sub })
  }
  gcloud pubsub subscriptions add-iam-policy-binding $sub --project $ProjectId `
    --member="serviceAccount:$LccSaEmail" --role="roles/pubsub.subscriber"
}

# --- Phase 5: Bot Secret（一時ファイル経由・末尾改行/BOMなし・登録後HMAC自己検査） ---
Write-Host "== 5. Bot Secret =="
$sec = Read-Host -AsSecureString "LINE WORKS Bot Secretを入力"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
$tmpSecret = Join-Path $env:TEMP ("lcc-secret-" + [guid]::NewGuid().ToString("N") + ".tmp")
try {
  # BOMなし・末尾改行なしで書き込み（パイプ渡しはエンコード事故があるため廃止）
  [IO.File]::WriteAllText($tmpSecret, $plain, [Text.UTF8Encoding]::new($false))
  if (Test-Exists @("secrets", "describe", "lineworks-bot-secret")) {
    Write-Host "  既存secretへ新versionを追加します"
    gcloud secrets versions add lineworks-bot-secret --project $ProjectId --data-file=$tmpSecret
  } else {
    gcloud secrets create lineworks-bot-secret --project $ProjectId --data-file=$tmpSecret
    [void]$created.Add(@{ kind = "secret"; id = "lineworks-bot-secret" })
  }
  # HMAC自己検査: 登録された実値を表示せず、入力値とのHMAC一致のみ確認
  $stored = (& gcloud secrets versions access latest --secret lineworks-bot-secret --project $ProjectId | Out-String).TrimEnd("`r", "`n")
  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes("lcc-selfcheck"))
  $d1 = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($plain)))
  $d2 = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($stored)))
  if ($d1 -eq $d2) { Write-Host "  HMAC自己検査: MATCH（登録値=入力値。実値は表示していません）" }
  else { Write-Host "STOP: HMAC自己検査MISMATCH（登録値が入力値と一致しません。改行/エンコードを確認してください）"; exit 1 }
} finally {
  if (Test-Path $tmpSecret) { [IO.File]::WriteAllText($tmpSecret, ("0" * 256)); Remove-Item $tmpSecret -Force }
  $plain = $null; $stored = $null
}

# --- Phase 6: Service Accounts（runtime/build分離・冪等） -------------------------
Write-Host "== 6. Service Accounts =="
if (Test-Exists @("iam", "service-accounts", "describe", $relaySa)) { Write-Host "  skip: $relaySa（既存）" }
else { gcloud iam service-accounts create lcc-lineworks-relay --project $ProjectId --display-name "LCC LINE WORKS relay (runtime)"; [void]$created.Add(@{ kind = "service-account"; id = $relaySa }) }
if (Test-Exists @("iam", "service-accounts", "describe", $buildSa)) { Write-Host "  skip: $buildSa（既存）" }
else { gcloud iam service-accounts create lcc-build --project $ProjectId --display-name "LCC build (Cloud Build専用)"; [void]$created.Add(@{ kind = "service-account"; id = $buildSa }) }

gcloud secrets add-iam-policy-binding lineworks-bot-secret --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/secretmanager.secretAccessor"
gcloud pubsub topics add-iam-policy-binding lcc-lineworks-events --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/pubsub.publisher"
# build SAのproject-level 3ロール（隠さず付与・teardownで解除）
foreach ($r in "roles/logging.logWriter", "roles/artifactregistry.createOnPushWriter", "roles/storage.objectViewer") {
  gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$buildSa" --role=$r --condition=None | Out-Null
  Write-Host "  granted: $buildSa -> $r (project-level)"
}

# --- Phase 7: 耐久outbox bucket（冪等） -------------------------------------------
Write-Host "== 7. 耐久outbox bucket =="
& gcloud storage buckets describe "gs://$outboxBucket" --project $ProjectId *> $null
if ($LASTEXITCODE -eq 0) { Write-Host "  skip: gs://$outboxBucket（既存）" }
else {
  gcloud storage buckets create "gs://$outboxBucket" --project $ProjectId --location $Region --uniform-bucket-level-access
  [void]$created.Add(@{ kind = "bucket"; id = $outboxBucket })
}
gcloud storage buckets add-iam-policy-binding "gs://$outboxBucket" --project $ProjectId `
  --member="serviceAccount:$relaySa" --role="roles/storage.objectCreator" | Out-Null
gcloud storage buckets add-iam-policy-binding "gs://$outboxBucket" --project $ProjectId `
  --member="serviceAccount:$LccSaEmail" --role="roles/storage.objectAdmin" | Out-Null

# --- Phase 8: Cloud Run deploy（専用build SA明示・既定SAへ依存しない） -------------
Write-Host "== 8. Cloud Run deploy =="
gcloud run deploy lcc-lineworks-relay --project $ProjectId --region $Region `
  --source "$PSScriptRoot\..\cloudrun\lcc-lineworks-relay" `
  --service-account $relaySa `
  --build-service-account "projects/$ProjectId/serviceAccounts/$buildSa" `
  --allow-unauthenticated `
  --max-instances 2 --memory 256Mi --cpu 1 `
  --set-env-vars "PUBSUB_TOPIC=projects/$ProjectId/topics/lcc-lineworks-events,LINEWORKS_ALLOWED_BOT_IDS=$LineworksBotId,LINEWORKS_OUTBOX_BUCKET=$outboxBucket" `
  --set-secrets "LINEWORKS_BOT_SECRET=lineworks-bot-secret:latest"
[void]$created.Add(@{ kind = "run-service"; id = "lcc-lineworks-relay@$Region" })
[void]$created.Add(@{ kind = "artifact-image"; id = "$Region-docker.pkg.dev/$ProjectId/cloud-run-source-deploy/lcc-lineworks-relay" })

# --- Phase 9: resource receipt保存 ------------------------------------------------
$receiptDir = Split-Path $receiptFile -Parent
if (-not (Test-Path $receiptDir)) { New-Item -ItemType Directory -Force $receiptDir | Out-Null }
$receipt = @{ projectId = $ProjectId; region = $Region; createdAt = (Get-Date -Format o); created = $created }
[IO.File]::WriteAllText($receiptFile, ($receipt | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Host "== 完了。作成リソースreceipt: $receiptFile =="
Write-Host "== 表示されたURL + /lineworks/callback をLINE WORKS Developer ConsoleのBot Callback URLへ登録してください =="
Write-Host "== 停止・削除は scripts\gcloud-teardown-realtime.ps1（-PlanOnlyで事前確認可能） =="
