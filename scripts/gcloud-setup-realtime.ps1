# =============================================================================
# LCC COMMAND リアルタイム連携 Google Cloud設定スクリプト
# - 実行は坂本社長承認後。詳細は EXTERNAL_SETUP_APPROVAL.md を参照。
# - preflight（対象project・deployer必要権限・**ownership**の確認）→ 計画/IAM差分表示 → yes → 実行。
#   receiptで所有確認できない同名Cloud Run/Secretが存在すれば、他のリソースを一切変更する前に
#   CONFIG_COLLISION で停止する（既存を無記録で更新しない）。
# - 全gcloud実行は $LASTEXITCODE を検査し失敗時は即停止（Invoke-GC）。
# - receiptは write-ahead: 外部変更の直前にPENDINGを記録→成功後COMMITTED。
#   gcloud成功直後の停止でも再setup冒頭のreconcileがPENDINGを実在照合し（実在→COMMITTED／不在→削除）孤児を残さない。
# - IAM bindingは構造化（member/role/targetKind/targetId）で記録し、teardownは完全一致で解除。
# - Artifact Registryはdeployが作った image digest だけを記録（image path全体を削除しない）。
# - -PlanOnly は表示のみ。-AutoApprove / -BotSecretEnvVar / -ReceiptFile はmock gcloud E2E用。
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$LccSaEmail,
  [Parameter(Mandatory = $true)][string]$LineworksBotId,
  [string]$Region = "asia-northeast1",
  [switch]$PlanOnly,
  [switch]$AutoApprove,
  [string]$BotSecretEnvVar = "",
  [string]$ReceiptFile = ""
)
$ErrorActionPreference = "Stop"
$relaySa = "lcc-lineworks-relay@$ProjectId.iam.gserviceaccount.com"
$buildSa = "lcc-build@$ProjectId.iam.gserviceaccount.com"
$outboxBucket = "$ProjectId-lineworks-outbox"
$runService = "lcc-lineworks-relay"
$secretName = "lineworks-bot-secret"
$imagePath = "$Region-docker.pkg.dev/$ProjectId/cloud-run-source-deploy/$runService"
$receiptFile = if ($ReceiptFile) { $ReceiptFile } else { Join-Path $PSScriptRoot "..\data\gcloud-setup-receipt.json" }

# ---------------------------------------------------------------- helpers ----
function Invoke-GC {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) { Write-Host "STOP: gcloud失敗（exit $LASTEXITCODE）: gcloud $($args -join ' ')"; exit 1 }
}
function Test-GCExists {
  & gcloud @args --project $ProjectId *> $null
  return ($LASTEXITCODE -eq 0)
}
function Test-GCBinding([string[]]$policyArgs, [string]$member, [string]$role) {
  $out = & gcloud @policyArgs --project $ProjectId --flatten="bindings[].members" `
    --filter="bindings.role=$role AND bindings.members=$member" --format="value(bindings.role)" 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  return [bool]($out | Where-Object { $_ -match [regex]::Escape($role) })
}

# --- receipt（write-ahead・原子的保存・kind+id/binding完全一致で重複排除） ---
function Read-Receipt {
  if (Test-Path $receiptFile) {
    $r = Get-Content $receiptFile -Raw | ConvertFrom-Json
    if ($r.projectId -ne $ProjectId) { Write-Host "STOP: receiptのprojectId不一致（$($r.projectId)）"; exit 1 }
    if ($null -eq $r.created) { $r | Add-Member -NotePropertyName created -NotePropertyValue @() }
    return $r
  }
  return [pscustomobject]@{ projectId = $ProjectId; region = $Region; createdAt = (Get-Date -Format o); created = @() }
}
function Save-Receipt($receipt) {
  $dir = Split-Path $receiptFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $tmp = "$receiptFile.tmp"
  [IO.File]::WriteAllText($tmp, ($receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  Move-Item -Force $tmp $receiptFile
}
function Find-Entry($receipt, [string]$kind, [string]$id) {
  return ($receipt.created | Where-Object { $_.kind -eq $kind -and $_.id -eq $id } | Select-Object -First 1)
}
function Set-Entry([string]$kind, [string]$id, [string]$status, $extra) {
  $receipt = Read-Receipt
  $entry = Find-Entry $receipt $kind $id
  if ($entry) {
    $entry.status = $status
    if ($extra) { foreach ($k in $extra.Keys) { $entry | Add-Member -NotePropertyName $k -NotePropertyValue $extra[$k] -Force } }
  } else {
    $obj = [ordered]@{ kind = $kind; id = $id; status = $status }
    if ($extra) { foreach ($k in $extra.Keys) { $obj[$k] = $extra[$k] } }
    $receipt.created = @($receipt.created) + @([pscustomobject]$obj)
  }
  Save-Receipt $receipt
}
function Receipt-Pending([string]$kind, [string]$id, $extra = $null) { Set-Entry $kind $id "PENDING" $extra }
function Receipt-Commit([string]$kind, [string]$id, $extra = $null) { Set-Entry $kind $id "COMMITTED" $extra }
function Receipt-Drop([string]$kind, [string]$id) {
  $receipt = Read-Receipt
  $receipt.created = @($receipt.created | Where-Object { -not ($_.kind -eq $kind -and $_.id -eq $id) })
  Save-Receipt $receipt
}
function Receipt-Owns([string]$kind, [string]$id) {
  $receipt = Read-Receipt
  $e = Find-Entry $receipt $kind $id
  return [bool]($e -and $e.status -eq "COMMITTED")
}
# 構造化binding
function Binding-Id([string]$member, [string]$role, [string]$targetKind, [string]$targetId) { return "$member|$role|$targetKind" + ":" + $targetId }
function Grant-Binding([string[]]$addArgs, [string[]]$policyArgs, [string]$member, [string]$role, [string]$targetKind, [string]$targetId) {
  $bid = Binding-Id $member $role $targetKind $targetId
  $extra = @{ binding = [ordered]@{ member = $member; role = $role; targetKind = $targetKind; targetId = $targetId } }
  if (Test-GCBinding $policyArgs $member $role) {
    if (Receipt-Owns "iam-binding" $bid) { Write-Host "  skip: binding既存（自作COMMITTED済み）$member -> $role @ $targetKind`:$targetId" }
    else { Write-Host "  skip: binding既存（他所有・自作扱いしない）$member -> $role @ $targetKind`:$targetId" }
    return
  }
  Receipt-Pending "iam-binding" $bid $extra
  Invoke-GC @addArgs --project $ProjectId --member=$member --role=$role
  Receipt-Commit "iam-binding" $bid $extra
}
# 実在集合の照合（reconcile用）
function Test-EntryExists($e) {
  switch ($e.kind) {
    "topic" { return (Test-GCExists pubsub topics describe $e.id) }
    "subscription" { return (Test-GCExists pubsub subscriptions describe $e.id) }
    "secret" { return (Test-GCExists secrets describe $e.id) }
    "service-account" { return (Test-GCExists iam service-accounts describe $e.id) }
    "bucket" { & gcloud storage buckets describe "gs://$($e.id)" --project $ProjectId *> $null; return ($LASTEXITCODE -eq 0) }
    "run-service" { return (Test-GCExists run services describe (($e.id -split "@")[0]) --region $Region) }
    "iam-binding" {
      $b = $e.binding; if (-not $b) { return $false }
      switch ($b.targetKind) {
        "topic" { return (Test-GCBinding @("pubsub", "topics", "get-iam-policy", $b.targetId) $b.member $b.role) }
        "subscription" { return (Test-GCBinding @("pubsub", "subscriptions", "get-iam-policy", $b.targetId) $b.member $b.role) }
        "secret" { return (Test-GCBinding @("secrets", "get-iam-policy", $b.targetId) $b.member $b.role) }
        "bucket" { return (Test-GCBinding @("storage", "buckets", "get-iam-policy", "gs://$($b.targetId)") $b.member $b.role) }
        "project" { return (Test-GCBinding @("projects", "get-iam-policy", $b.targetId) $b.member $b.role) }
        "run-service" { return (Test-GCBinding @("run", "services", "get-iam-policy", $b.targetId, "--region", $Region) $b.member $b.role) }
      }
      return $false
    }
    "artifact-image" {
      if (-not $e.digest) { return $false }
      & gcloud artifacts docker images describe "$($e.id)@$($e.digest)" --project $ProjectId *> $null
      return ($LASTEXITCODE -eq 0)
    }
  }
  return $false
}

# ------------------------------------------------------- Phase 0a: preflight --
Write-Host "== preflight（読み取りのみ） =="
$account = (& gcloud config get-value account 2>$null | Select-Object -First 1)
if (-not $account) { Write-Host "STOP: gcloudにログインしていません（gcloud auth login）"; exit 1 }
Write-Host "  実行者(deployer): $account"
& gcloud projects describe $ProjectId --format="table(projectId,projectNumber,lifecycleState)"
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: project $ProjectId へアクセスできません"; exit 1 }
if ($account -like "*gserviceaccount.com") { Write-Host "STOP: 実行者がservice accountです。人間のdeployerアカウントで実行してください"; exit 1 }
$deployerRequired = @(
  "roles/run.admin", "roles/iam.serviceAccountAdmin", "roles/iam.serviceAccountUser", "roles/pubsub.admin",
  "roles/secretmanager.admin", "roles/storage.admin", "roles/serviceusage.serviceUsageAdmin", "roles/resourcemanager.projectIamAdmin"
)
$roles = @(& gcloud projects get-iam-policy $ProjectId --flatten="bindings[].members" --filter="bindings.members:$account" --format="value(bindings.role)" 2>$null)
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: IAM policyを取得できません"; exit 1 }
Write-Host "  deployerのproject-levelロール: $($roles -join ', ')"
if ($roles -notcontains "roles/owner") {
  $missing = $deployerRequired | Where-Object { $roles -notcontains $_ }
  if ($missing) { Write-Host "STOP: deployerに次のロールが不足しています（変更前に停止）:"; $missing | ForEach-Object { Write-Host "    $_" }; exit 1 }
}

# --- write-ahead reconcile: 前回PENDINGを実在照合（gcloud成功直後の停止からの復旧） ---
$rc = Read-Receipt
$pend = @($rc.created | Where-Object { $_.status -eq "PENDING" })
foreach ($p in $pend) {
  if (Test-EntryExists $p) { Set-Entry $p.kind $p.id "COMMITTED" $null; Write-Host "  reconcile: PENDING→COMMITTED（実在確認）$($p.kind) $($p.id)" }
  else { Receipt-Drop $p.kind $p.id; Write-Host "  reconcile: PENDING削除（未作成）$($p.kind) $($p.id)" }
}

# --- ownership preflight: 同名Cloud Run/Secretが存在し、receiptで所有確認できなければ変更前に停止 ---
$collisions = @()
if ((Test-GCExists run services describe $runService --region $Region) -and -not (Receipt-Owns "run-service" "$runService@$Region")) {
  $collisions += "Cloud Run service $runService@$Region"
}
if ((Test-GCExists secrets describe $secretName) -and -not (Receipt-Owns "secret" $secretName)) {
  $collisions += "Secret $secretName"
}
if ($collisions.Count -gt 0) {
  Write-Host "STOP: CONFIG_COLLISION — receiptで所有確認できない同名リソースが存在します。既存を無記録で更新しないため、他のリソースを一切変更せず停止します:"
  $collisions | ForEach-Object { Write-Host "    $_" }
  Write-Host "  対処: 既存を別名へ退避するか、正しいreceiptを -ReceiptFile で指定してください"
  exit 3
}

# ------------------------------------------------- Phase 0b: 計画/IAM差分表示 --
Write-Host ""
Write-Host "== 実行計画（既存リソース/bindingはskip=冪等・自作扱いしない。receiptはPENDING→COMMITTED） =="
Write-Host "  [作成] API有効化: gmail / pubsub / run / secretmanager / cloudbuild / artifactregistry"
Write-Host "  [作成] Pub/Sub topic: lcc-gmail-events, lcc-lineworks-events"
Write-Host "  [作成] Pub/Sub subscription: lcc-gmail-events-pull, lcc-lineworks-events-pull (ack 60s / retention 7d)"
Write-Host "  [作成] Service Account(runtime): $relaySa"
Write-Host "  [作成] Service Account(build): $buildSa"
Write-Host "  [作成] Secret: $secretName（一時ファイル・HMAC自己検査・実値非表示）"
Write-Host "  [作成] GCS bucket(耐久outbox): $outboxBucket"
Write-Host "  [作成] Cloud Run: $runService（region=$Region, max-instances=2, 256Mi, --build-service-account=$buildSa）"
Write-Host "  [自動作成] Artifact Registry repo cloud-run-source-deploy（共有・保護）+ relayイメージ（**digestのみ**記録・削除）"
Write-Host "  [記録] receipt: $receiptFile"
Write-Host ""
Write-Host "== IAM差分（deployer=$account / build=$buildSa / runtime=$relaySa） =="
Write-Host "  [project-level 1件] $buildSa -> roles/run.builder"
Write-Host "  [リソース単位] gmail-api-push -> pubsub.publisher @topic lcc-gmail-events / $LccSaEmail -> pubsub.subscriber @2 subs, storage.objectAdmin @bucket"
Write-Host "                 $relaySa -> secretmanager.secretAccessor @secret, pubsub.publisher @topic lcc-lineworks-events, storage.objectCreator @bucket"
Write-Host "                 allUsers -> run.invoker @$runService（Webhook受口）"
Write-Host ""
if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみで終了します（外部変更なし）"; exit 0 }
if (-not $AutoApprove) {
  $confirm = Read-Host "上記をすべて確認しました。実行する場合は yes と入力してください"
  if ($confirm -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 }
}

# ------------------------------------------------------------- Phase 1: API --
Write-Host "== 1. API有効化 =="
Invoke-GC services enable gmail.googleapis.com pubsub.googleapis.com run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project $ProjectId

# ---------------------------------------------------------- Phase 2: topics --
Write-Host "== 2. Pub/Sub topics =="
foreach ($t in "lcc-gmail-events", "lcc-lineworks-events") {
  if (Test-GCExists pubsub topics describe $t) { Write-Host "  skip: topic $t（既存・自作扱いしない）" }
  else { Receipt-Pending "topic" $t; Invoke-GC pubsub topics create $t --project $ProjectId; Receipt-Commit "topic" $t }
}

# ------------------------------------------------ Phase 3: Gmail push binding --
Write-Host "== 3. Gmail push権限 =="
Grant-Binding @("pubsub", "topics", "add-iam-policy-binding", "lcc-gmail-events") @("pubsub", "topics", "get-iam-policy", "lcc-gmail-events") `
  "serviceAccount:gmail-api-push@system.gserviceaccount.com" "roles/pubsub.publisher" "topic" "lcc-gmail-events"

# --------------------------------------------------- Phase 4: subscriptions --
Write-Host "== 4. Pull subscriptions =="
foreach ($pair in @(@("lcc-gmail-events-pull", "lcc-gmail-events"), @("lcc-lineworks-events-pull", "lcc-lineworks-events"))) {
  $sub = $pair[0]; $topic = $pair[1]
  if (Test-GCExists pubsub subscriptions describe $sub) { Write-Host "  skip: subscription $sub（既存）" }
  else {
    Receipt-Pending "subscription" $sub
    Invoke-GC pubsub subscriptions create $sub --topic $topic --project $ProjectId --ack-deadline 60 --message-retention-duration 7d
    Receipt-Commit "subscription" $sub
  }
  Grant-Binding @("pubsub", "subscriptions", "add-iam-policy-binding", $sub) @("pubsub", "subscriptions", "get-iam-policy", $sub) `
    "serviceAccount:$LccSaEmail" "roles/pubsub.subscriber" "subscription" $sub
}

# ---------------------------------------------------------- Phase 5: Secret --
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
  if (Test-GCExists secrets describe $secretName) {
    # ownership preflightを通過している＝receiptで所有確認済み。自作secretへ新versionを追加
    Write-Host "  自作secret（receipt所有）へ新versionを追加します"
    Invoke-GC secrets versions add $secretName --project $ProjectId --data-file=$tmpSecret
  } else {
    Receipt-Pending "secret" $secretName
    Invoke-GC secrets create $secretName --project $ProjectId --data-file=$tmpSecret
    Receipt-Commit "secret" $secretName
  }
  $stored = (& gcloud secrets versions access latest --secret $secretName --project $ProjectId | Out-String).TrimEnd("`r", "`n")
  if ($LASTEXITCODE -ne 0) { Write-Host "STOP: secret読み戻しに失敗"; exit 1 }
  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes("lcc-selfcheck"))
  $d1 = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($plain)))
  $d2 = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($stored)))
  if ($d1 -eq $d2) { Write-Host "  HMAC自己検査: MATCH（実値は表示していません）" }
  else { Write-Host "STOP: HMAC自己検査MISMATCH"; exit 1 }
} finally {
  if (Test-Path $tmpSecret) { [IO.File]::WriteAllText($tmpSecret, ("0" * 256)); Remove-Item $tmpSecret -Force }
  $plain = $null; $stored = $null
}

# ------------------------------------------------ Phase 6: Service Accounts --
Write-Host "== 6. Service Accounts =="
if (Test-GCExists iam service-accounts describe $relaySa) { Write-Host "  skip: $relaySa（既存）" }
else { Receipt-Pending "service-account" $relaySa; Invoke-GC iam service-accounts create lcc-lineworks-relay --project $ProjectId --display-name "LCC LINE WORKS relay (runtime)"; Receipt-Commit "service-account" $relaySa }
if (Test-GCExists iam service-accounts describe $buildSa) { Write-Host "  skip: $buildSa（既存）" }
else { Receipt-Pending "service-account" $buildSa; Invoke-GC iam service-accounts create lcc-build --project $ProjectId --display-name "LCC build (Cloud Build専用)"; Receipt-Commit "service-account" $buildSa }
Grant-Binding @("secrets", "add-iam-policy-binding", $secretName) @("secrets", "get-iam-policy", $secretName) `
  "serviceAccount:$relaySa" "roles/secretmanager.secretAccessor" "secret" $secretName
Grant-Binding @("pubsub", "topics", "add-iam-policy-binding", "lcc-lineworks-events") @("pubsub", "topics", "get-iam-policy", "lcc-lineworks-events") `
  "serviceAccount:$relaySa" "roles/pubsub.publisher" "topic" "lcc-lineworks-events"
Grant-Binding @("projects", "add-iam-policy-binding", $ProjectId) @("projects", "get-iam-policy", $ProjectId) `
  "serviceAccount:$buildSa" "roles/run.builder" "project" $ProjectId

# ---------------------------------------------------- Phase 7: outbox bucket --
Write-Host "== 7. 耐久outbox bucket =="
& gcloud storage buckets describe "gs://$outboxBucket" --project $ProjectId *> $null
if ($LASTEXITCODE -eq 0) { Write-Host "  skip: gs://$outboxBucket（既存）" }
else {
  Receipt-Pending "bucket" $outboxBucket
  Invoke-GC storage buckets create "gs://$outboxBucket" --project $ProjectId --location $Region --uniform-bucket-level-access
  Receipt-Commit "bucket" $outboxBucket
}
Grant-Binding @("storage", "buckets", "add-iam-policy-binding", "gs://$outboxBucket") @("storage", "buckets", "get-iam-policy", "gs://$outboxBucket") `
  "serviceAccount:$relaySa" "roles/storage.objectCreator" "bucket" $outboxBucket
Grant-Binding @("storage", "buckets", "add-iam-policy-binding", "gs://$outboxBucket") @("storage", "buckets", "get-iam-policy", "gs://$outboxBucket") `
  "serviceAccount:$LccSaEmail" "roles/storage.objectAdmin" "bucket" $outboxBucket

# -------------------------------------------------- Phase 8: Cloud Run deploy --
Write-Host "== 8. Cloud Run deploy =="
$runExisted = Test-GCExists run services describe $runService --region $Region  # ownership preflight通過＝自作のみ
if (-not $runExisted) { Receipt-Pending "run-service" "$runService@$Region" }
Invoke-GC run deploy $runService --project $ProjectId --region $Region `
  --source "$PSScriptRoot\..\cloudrun\lcc-lineworks-relay" `
  --service-account $relaySa `
  --build-service-account "projects/$ProjectId/serviceAccounts/$buildSa" `
  --allow-unauthenticated `
  --max-instances 2 --memory 256Mi --cpu 1 `
  --set-env-vars "PUBSUB_TOPIC=projects/$ProjectId/topics/lcc-lineworks-events,LINEWORKS_ALLOWED_BOT_IDS=$LineworksBotId,LINEWORKS_OUTBOX_BUCKET=$outboxBucket" `
  --set-secrets "LINEWORKS_BOT_SECRET=${secretName}:latest"
if (-not $runExisted) {
  Receipt-Commit "run-service" "$runService@$Region"
  # allUsers invokerは--allow-unauthenticatedの実体。構造化bindingとして記録
  Receipt-Commit "iam-binding" (Binding-Id "allUsers" "roles/run.invoker" "run-service" "$runService@$Region") `
    @{ binding = [ordered]@{ member = "allUsers"; role = "roles/run.invoker"; targetKind = "run-service"; targetId = "$runService@$Region" } }
}
# このdeployが作ったイメージdigestだけを記録（image path全体を削除対象にしない）
$fmtArg = '--format=value(spec.template.spec.containers[0].image)'
$digestOut = @(& gcloud run services describe $runService --project $ProjectId --region $Region $fmtArg 2>$null)
$digest = ($digestOut | Where-Object { "$_" -match "@sha256:" } | Select-Object -First 1)
if ("$digest" -match "@(sha256:[0-9a-f]+)\s*$") {
  Receipt-Commit "artifact-image" $imagePath @{ digest = $Matches[1] }
  Write-Host "  image digest記録: $($Matches[1].Substring(0, 19))..."
} else {
  Write-Host "  注意: image digestを取得できず記録しません（teardownでイメージ削除は行われません）"
}

Write-Host "== 完了。receipt: $receiptFile =="
Write-Host "== 表示されたURL + /lineworks/callback をLINE WORKS ConsoleのBot Callback URLへ登録してください =="
Write-Host "== 停止・削除は scripts\gcloud-teardown-realtime.ps1（-PlanOnlyで事前確認可能） =="
