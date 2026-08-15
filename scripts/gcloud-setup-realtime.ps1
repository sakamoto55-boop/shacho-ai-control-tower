# =============================================================================
# LCC COMMAND リアルタイム連携 Google Cloud設定スクリプト
# - 実行は坂本社長承認後。詳細は EXTERNAL_SETUP_APPROVAL.md を参照。
# - preflight（対象project・deployer必要権限の確認。不足なら変更前に停止）
#   → 計画/IAM差分表示 → `yes` 明示入力 → 実行。-PlanOnly は表示のみ（外部変更ゼロ）。
# - 全gcloud実行は $LASTEXITCODE を検査し、失敗時は即停止する（Invoke-GC）。
# - 冪等: 既存リソース・既存IAM bindingはskipし「自作扱いしない」。
# - resource receipt（data\gcloud-setup-receipt.json）は**処理成功ごとに原子的へマージ保存**
#   （途中失敗・再実行でも消失しない）。teardownはreceipt記載分のみ削除する。
# - -AutoApprove / -BotSecretEnvVar はmock gcloudによるE2E検証用（対話なし実行）。
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$LccSaEmail,
  [Parameter(Mandatory = $true)][string]$LineworksBotId,
  [string]$Region = "asia-northeast1",
  [switch]$PlanOnly,
  [switch]$AutoApprove,          # E2E検証用: yes確認を省略（本番では使わない）
  [string]$BotSecretEnvVar = "", # E2E検証用: Secretを環境変数から読む（本番は非表示対話入力）
  [string]$ReceiptFile = ""      # 省略時は data\gcloud-setup-receipt.json
)
$ErrorActionPreference = "Stop"
$relaySa = "lcc-lineworks-relay@$ProjectId.iam.gserviceaccount.com"
$buildSa = "lcc-build@$ProjectId.iam.gserviceaccount.com"
$outboxBucket = "$ProjectId-lineworks-outbox"
$receiptFile = if ($ReceiptFile) { $ReceiptFile } else { Join-Path $PSScriptRoot "..\data\gcloud-setup-receipt.json" }

# --- gcloud実行ヘルパー: 失敗時は即停止（$LASTEXITCODE検査） ---
function Invoke-GC {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) {
    Write-Host "STOP: gcloud失敗（exit $LASTEXITCODE）: gcloud $($args -join ' ')"
    exit 1
  }
}
# 存在確認（失敗=不存在として扱う。これは意図的に停止しない）
function Test-GCExists {
  & gcloud @args --project $ProjectId *> $null
  return ($LASTEXITCODE -eq 0)
}
# IAM binding存在確認（既存bindingを自作扱いしないため）
function Test-GCBinding([string[]]$policyArgs, [string]$member, [string]$role) {
  $out = & gcloud @policyArgs --project $ProjectId --flatten="bindings[].members" `
    --filter="bindings.role=$role AND bindings.members=$member" --format="value(bindings.role)" 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  return [bool]($out | Where-Object { $_ -match [regex]::Escape($role) })
}
# receipt: 成功ごとに原子的マージ保存（temp+move・既存内容を失わない・kind+id重複排除）
function Add-Receipt([string]$kind, [string]$id) {
  $entry = @{ kind = $kind; id = $id }
  $receipt = $null
  if (Test-Path $receiptFile) {
    $receipt = Get-Content $receiptFile -Raw | ConvertFrom-Json
    if ($receipt.projectId -ne $ProjectId) { Write-Host "STOP: receiptのprojectId不一致（$($receipt.projectId)）"; exit 1 }
  }
  if ($null -eq $receipt) {
    $receipt = [pscustomobject]@{ projectId = $ProjectId; region = $Region; createdAt = (Get-Date -Format o); created = @() }
  }
  $exists = $receipt.created | Where-Object { $_.kind -eq $kind -and $_.id -eq $id }
  if (-not $exists) {
    $receipt.created = @($receipt.created) + @([pscustomobject]$entry)
    $dir = Split-Path $receiptFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $tmp = "$receiptFile.tmp"
    [IO.File]::WriteAllText($tmp, ($receipt | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Move-Item -Force $tmp $receiptFile
  }
}
# binding付与: 既存ならskip（自作扱いしない）・新規付与のみreceiptへ記録
function Grant-Binding([string[]]$resourceArgs, [string[]]$policyArgs, [string]$member, [string]$role, [string]$receiptId) {
  if (Test-GCBinding $policyArgs $member $role) {
    Write-Host "  skip: binding既存 $member -> $role（自作扱いしない）"
    return
  }
  Invoke-GC @resourceArgs --project $ProjectId --member=$member --role=$role
  Add-Receipt "iam-binding" $receiptId
}

# --- Phase 0a: preflight（読み取りのみ） ---------------------------------------
Write-Host "== preflight（読み取りのみ） =="
$account = (& gcloud config get-value account 2>$null | Select-Object -First 1)
if (-not $account) { Write-Host "STOP: gcloudにログインしていません（gcloud auth login）"; exit 1 }
Write-Host "  実行者(deployer): $account"
& gcloud projects describe $ProjectId --format="table(projectId,projectNumber,lifecycleState)"
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: project $ProjectId へアクセスできません（-ProjectId誤りまたは権限不足）"; exit 1 }
if ($account -like "*gserviceaccount.com") {
  Write-Host "STOP: 実行者がservice accountです。人間のdeployerアカウントで実行してください"
  exit 1
}
# deployer必要権限（Google公式のdeploy要件+本スクリプトの作成対象に基づく明示リスト。owner保持なら充足）
$deployerRequired = @(
  "roles/run.admin",                       # Cloud Run deploy/公開設定
  "roles/iam.serviceAccountAdmin",         # build/runtime SAの作成
  "roles/iam.serviceAccountUser",          # deploy時にSAを使用する権限
  "roles/pubsub.admin",                    # topic/subscription作成とIAM
  "roles/secretmanager.admin",             # Secret作成とIAM
  "roles/storage.admin",                   # outbox bucket作成とIAM
  "roles/serviceusage.serviceUsageAdmin",  # API有効化
  "roles/resourcemanager.projectIamAdmin"  # build SAへのproject-level付与
)
$roles = @(& gcloud projects get-iam-policy $ProjectId --flatten="bindings[].members" --filter="bindings.members:$account" --format="value(bindings.role)" 2>$null)
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: IAM policyを取得できません"; exit 1 }
Write-Host "  deployerのproject-levelロール: $($roles -join ', ')"
if ($roles -notcontains "roles/owner") {
  $missing = $deployerRequired | Where-Object { $roles -notcontains $_ }
  if ($missing) {
    Write-Host "STOP: deployerに次のロールが不足しています（変更前に停止）:"
    $missing | ForEach-Object { Write-Host "    $_" }
    exit 1
  }
}

# --- Phase 0b: 実行計画とIAM差分の表示 ------------------------------------------
Write-Host ""
Write-Host "== 実行計画（この内容以外は変更しません。既存リソース/bindingはskip=冪等・自作扱いしない） =="
Write-Host "  [作成] API有効化: gmail / pubsub / run / secretmanager / cloudbuild / artifactregistry"
Write-Host "  [作成] Pub/Sub topic: lcc-gmail-events, lcc-lineworks-events"
Write-Host "  [作成] Pub/Sub subscription: lcc-gmail-events-pull, lcc-lineworks-events-pull (ack 60s / retention 7d)"
Write-Host "  [作成] Service Account(runtime): $relaySa"
Write-Host "  [作成] Service Account(build): $buildSa（既定Compute/Cloud Build SAへ依存しない）"
Write-Host "  [作成] Secret: lineworks-bot-secret（一時ファイル経由・登録後HMAC自己検査・実値非表示）"
Write-Host "  [作成] GCS bucket(耐久outbox): $outboxBucket"
Write-Host "  [作成] Cloud Run: lcc-lineworks-relay（region=$Region, max-instances=2, 256Mi, --build-service-account=$buildSa）"
Write-Host "  [自動作成] Artifact Registry repo cloud-run-source-deploy + relayイメージ / Cloud Build用bucket（共有扱い=teardownで削除しない）"
Write-Host "  [記録] receipt: $receiptFile（成功ごとに原子的マージ保存）"
Write-Host ""
Write-Host "== IAM差分（deployer=$account / build=$buildSa / runtime=$relaySa） =="
Write-Host "  [project-level追加 1件] $buildSa -> roles/run.builder（Google公式のCloud Runソースbuild用ロール）"
Write-Host "  [リソース単位追加]"
Write-Host "    gmail-api-push@system.gserviceaccount.com -> roles/pubsub.publisher @ topic lcc-gmail-events"
Write-Host "    $LccSaEmail -> roles/pubsub.subscriber @ subscription lcc-gmail-events-pull / lcc-lineworks-events-pull"
Write-Host "    $LccSaEmail -> roles/storage.objectAdmin @ bucket $outboxBucket"
Write-Host "    $relaySa -> roles/secretmanager.secretAccessor @ secret lineworks-bot-secret"
Write-Host "    $relaySa -> roles/pubsub.publisher @ topic lcc-lineworks-events"
Write-Host "    $relaySa -> roles/storage.objectCreator @ bucket $outboxBucket"
Write-Host "    allUsers -> roles/run.invoker @ Cloud Run lcc-lineworks-relay（Webhook受口）"
Write-Host ""

if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみで終了します（外部変更なし）"; exit 0 }
if (-not $AutoApprove) {
  $confirm = Read-Host "上記をすべて確認しました。実行する場合は yes と入力してください"
  if ($confirm -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 }
}

# --- Phase 1: API有効化 -----------------------------------------------------------
Write-Host "== 1. API有効化 =="
Invoke-GC services enable gmail.googleapis.com pubsub.googleapis.com run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $ProjectId

# --- Phase 2: Pub/Sub topics（冪等） ----------------------------------------------
Write-Host "== 2. Pub/Sub topics =="
foreach ($t in "lcc-gmail-events", "lcc-lineworks-events") {
  if (Test-GCExists pubsub topics describe $t) { Write-Host "  skip: topic $t（既存・自作扱いしない）" }
  else { Invoke-GC pubsub topics create $t --project $ProjectId; Add-Receipt "topic" $t }
}

# --- Phase 3: Gmail push権限（既存bindingはskip） ---------------------------------
Write-Host "== 3. Gmail push権限 =="
Grant-Binding @("pubsub", "topics", "add-iam-policy-binding", "lcc-gmail-events") `
  @("pubsub", "topics", "get-iam-policy", "lcc-gmail-events") `
  "serviceAccount:gmail-api-push@system.gserviceaccount.com" "roles/pubsub.publisher" `
  "gmail-api-push|roles/pubsub.publisher|topic:lcc-gmail-events"

# --- Phase 4: Pull subscriptions（冪等） ------------------------------------------
Write-Host "== 4. Pull subscriptions =="
foreach ($pair in @(@("lcc-gmail-events-pull", "lcc-gmail-events"), @("lcc-lineworks-events-pull", "lcc-lineworks-events"))) {
  $sub = $pair[0]; $topic = $pair[1]
  if (Test-GCExists pubsub subscriptions describe $sub) { Write-Host "  skip: subscription $sub（既存）" }
  else {
    Invoke-GC pubsub subscriptions create $sub --topic $topic --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
    Add-Receipt "subscription" $sub
  }
  Grant-Binding @("pubsub", "subscriptions", "add-iam-policy-binding", $sub) `
    @("pubsub", "subscriptions", "get-iam-policy", $sub) `
    "serviceAccount:$LccSaEmail" "roles/pubsub.subscriber" `
    "$LccSaEmail|roles/pubsub.subscriber|subscription:$sub"
}

# --- Phase 5: Bot Secret（一時ファイル・BOM/末尾改行なし・HMAC自己検査） -----------
Write-Host "== 5. Bot Secret =="
if ($BotSecretEnvVar) {
  $plain = [Environment]::GetEnvironmentVariable($BotSecretEnvVar)
  if (-not $plain) { Write-Host "STOP: 環境変数 $BotSecretEnvVar が未設定です"; exit 1 }
} else {
  $sec = Read-Host -AsSecureString "LINE WORKS Bot Secretを入力"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$tmpSecret = Join-Path ([IO.Path]::GetTempPath()) ("lcc-secret-" + [guid]::NewGuid().ToString("N") + ".tmp")
try {
  [IO.File]::WriteAllText($tmpSecret, $plain, [Text.UTF8Encoding]::new($false))
  if (Test-GCExists secrets describe lineworks-bot-secret) {
    Write-Host "  既存secretへ新versionを追加します"
    Invoke-GC secrets versions add lineworks-bot-secret --project $ProjectId --data-file=$tmpSecret
  } else {
    Invoke-GC secrets create lineworks-bot-secret --project $ProjectId --data-file=$tmpSecret
    Add-Receipt "secret" "lineworks-bot-secret"
  }
  $stored = (& gcloud secrets versions access latest --secret lineworks-bot-secret --project $ProjectId | Out-String).TrimEnd("`r", "`n")
  if ($LASTEXITCODE -ne 0) { Write-Host "STOP: secret読み戻しに失敗"; exit 1 }
  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes("lcc-selfcheck"))
  $d1 = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($plain)))
  $d2 = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($stored)))
  if ($d1 -eq $d2) { Write-Host "  HMAC自己検査: MATCH（実値は表示していません）" }
  else { Write-Host "STOP: HMAC自己検査MISMATCH（登録値が入力値と一致しません）"; exit 1 }
} finally {
  if (Test-Path $tmpSecret) { [IO.File]::WriteAllText($tmpSecret, ("0" * 256)); Remove-Item $tmpSecret -Force }
  $plain = $null; $stored = $null
}

# --- Phase 6: Service Accounts（runtime/build分離・冪等） -------------------------
Write-Host "== 6. Service Accounts =="
if (Test-GCExists iam service-accounts describe $relaySa) { Write-Host "  skip: $relaySa（既存）" }
else { Invoke-GC iam service-accounts create lcc-lineworks-relay --project $ProjectId --display-name "LCC LINE WORKS relay (runtime)"; Add-Receipt "service-account" $relaySa }
if (Test-GCExists iam service-accounts describe $buildSa) { Write-Host "  skip: $buildSa（既存）" }
else { Invoke-GC iam service-accounts create lcc-build --project $ProjectId --display-name "LCC build (Cloud Build専用)"; Add-Receipt "service-account" $buildSa }

Grant-Binding @("secrets", "add-iam-policy-binding", "lineworks-bot-secret") `
  @("secrets", "get-iam-policy", "lineworks-bot-secret") `
  "serviceAccount:$relaySa" "roles/secretmanager.secretAccessor" `
  "$relaySa|roles/secretmanager.secretAccessor|secret:lineworks-bot-secret"
Grant-Binding @("pubsub", "topics", "add-iam-policy-binding", "lcc-lineworks-events") `
  @("pubsub", "topics", "get-iam-policy", "lcc-lineworks-events") `
  "serviceAccount:$relaySa" "roles/pubsub.publisher" `
  "$relaySa|roles/pubsub.publisher|topic:lcc-lineworks-events"
# build SA: Google公式のCloud Runソースbuild用ロール（roles/run.builder）1件のみ・project-level
Grant-Binding @("projects", "add-iam-policy-binding", $ProjectId) `
  @("projects", "get-iam-policy", $ProjectId) `
  "serviceAccount:$buildSa" "roles/run.builder" `
  "$buildSa|roles/run.builder|project:$ProjectId"

# --- Phase 7: 耐久outbox bucket（冪等） -------------------------------------------
Write-Host "== 7. 耐久outbox bucket =="
& gcloud storage buckets describe "gs://$outboxBucket" --project $ProjectId *> $null
if ($LASTEXITCODE -eq 0) { Write-Host "  skip: gs://$outboxBucket（既存）" }
else {
  Invoke-GC storage buckets create "gs://$outboxBucket" --project $ProjectId --location $Region --uniform-bucket-level-access
  Add-Receipt "bucket" $outboxBucket
}
Grant-Binding @("storage", "buckets", "add-iam-policy-binding", "gs://$outboxBucket") `
  @("storage", "buckets", "get-iam-policy", "gs://$outboxBucket") `
  "serviceAccount:$relaySa" "roles/storage.objectCreator" `
  "$relaySa|roles/storage.objectCreator|bucket:$outboxBucket"
Grant-Binding @("storage", "buckets", "add-iam-policy-binding", "gs://$outboxBucket") `
  @("storage", "buckets", "get-iam-policy", "gs://$outboxBucket") `
  "serviceAccount:$LccSaEmail" "roles/storage.objectAdmin" `
  "$LccSaEmail|roles/storage.objectAdmin|bucket:$outboxBucket"

# --- Phase 8: Cloud Run deploy（専用build SA明示・既存サービスを自作扱いしない） ---
Write-Host "== 8. Cloud Run deploy =="
# 事前存在確認: 既存サービスへのdeployは更新であり、receiptへ自作登録しない（teardownで消さない）
$runExisted = Test-GCExists run services describe lcc-lineworks-relay --region $Region
if ($runExisted) { Write-Host "  既存Cloud Runサービスを更新します（自作扱いしない=teardown対象に登録しない）" }
Invoke-GC run deploy lcc-lineworks-relay --project $ProjectId --region $Region `
  --source "$PSScriptRoot\..\cloudrun\lcc-lineworks-relay" `
  --service-account $relaySa `
  --build-service-account "projects/$ProjectId/serviceAccounts/$buildSa" `
  --allow-unauthenticated `
  --max-instances 2 --memory 256Mi --cpu 1 `
  --set-env-vars "PUBSUB_TOPIC=projects/$ProjectId/topics/lcc-lineworks-events,LINEWORKS_ALLOWED_BOT_IDS=$LineworksBotId,LINEWORKS_OUTBOX_BUCKET=$outboxBucket" `
  --set-secrets "LINEWORKS_BOT_SECRET=lineworks-bot-secret:latest"
if (-not $runExisted) {
  Add-Receipt "run-service" "lcc-lineworks-relay@$Region"
  Add-Receipt "artifact-image" "$Region-docker.pkg.dev/$ProjectId/cloud-run-source-deploy/lcc-lineworks-relay"
  Add-Receipt "iam-binding" "allUsers|roles/run.invoker|run-service:lcc-lineworks-relay@$Region"
}

Write-Host "== 完了。receipt: $receiptFile =="
Write-Host "== 表示されたURL + /lineworks/callback をLINE WORKS ConsoleのBot Callback URLへ登録してください =="
Write-Host "== 停止・削除は scripts\gcloud-teardown-realtime.ps1（-PlanOnlyで事前確認可能） =="
