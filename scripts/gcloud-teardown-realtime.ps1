# =============================================================================
# LCC COMMAND リアルタイム連携 teardownスクリプト（停止・削除・rollback）
# - receipt（write-ahead: PENDING/COMMITTED）に記録された自作リソース・自作IAM bindingのみ削除する。
#   冒頭でPENDINGを実在照合（実在→COMMITTED扱いで削除対象／不在→エントリ削除）し孤児を残さない。
# - IAM bindingは receipt.binding（member/role/targetKind/targetId）の完全一致で解除する。
# - Artifact Registryは receipt.digest のイメージだけ削除（image path全体・共有repoは削除しない）。
# - 既存リソース・既存bindingは自作扱いしない（receiptに載っていないものへ触れない）。
# - -PlanOnly は表示のみ。実削除は yes 明示入力（-AutoApproveはmock E2E用）。全gcloudは$LASTEXITCODE検査。
# 停止のみの順序: 1) LINE WORKS ConsoleでCallback URL削除 2) 本スクリプト -StopOnly（invoker解除）
#   3) npm run gmail:authorize -- --stop 4) stop-lcc-command.bat
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "asia-northeast1",
  [string]$ReceiptFile = "",
  [switch]$PlanOnly,
  [switch]$StopOnly,
  [switch]$AutoApprove
)
$ErrorActionPreference = "Stop"
if (-not $ReceiptFile) { $ReceiptFile = Join-Path $PSScriptRoot "..\data\gcloud-setup-receipt.json" }

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
function Save-Receipt($receipt) {
  $tmp = "$ReceiptFile.tmp"
  [IO.File]::WriteAllText($tmp, ($receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  Move-Item -Force $tmp $ReceiptFile
}
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
        "run-service" { return (Test-GCBinding @("run", "services", "get-iam-policy", (($b.targetId -split "@")[0]), "--region", $Region) $b.member $b.role) }
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

Write-Host "== preflight（読み取りのみ） =="
$account = (& gcloud config get-value account 2>$null | Select-Object -First 1)
if (-not $account) { Write-Host "STOP: gcloudにログインしていません"; exit 1 }
& gcloud projects describe $ProjectId --format="value(projectId)" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "STOP: project $ProjectId へアクセスできません"; exit 1 }
Write-Host "  実行者: $account / 対象project: $ProjectId"

if ($StopOnly) {
  Write-Host "== 受信停止のみ（削除なし） =="
  Write-Host "  [計画] allUsers -> roles/run.invoker を Cloud Run lcc-lineworks-relay から解除"
  if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみ"; exit 0 }
  if (-not $AutoApprove) { $c = Read-Host "実行する場合は yes と入力してください"; if ($c -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 } }
  Invoke-GC run services remove-iam-policy-binding lcc-lineworks-relay --project $ProjectId --region $Region --member="allUsers" --role="roles/run.invoker"
  Write-Host "== 完了: 公開Invoker解除 =="
  exit 0
}

if (-not (Test-Path $ReceiptFile)) { Write-Host "STOP: receiptが見つかりません（$ReceiptFile）"; exit 1 }
$receipt = Get-Content $ReceiptFile -Raw | ConvertFrom-Json
if ($receipt.projectId -ne $ProjectId) { Write-Host "STOP: receiptのprojectId（$($receipt.projectId)）と -ProjectId（$ProjectId）が一致しません"; exit 1 }
if ($null -eq $receipt.created) { $receipt | Add-Member -NotePropertyName created -NotePropertyValue @() }

# --- write-ahead reconcile: PENDINGを実在照合（孤児を残さない） ---
$kept = @()
foreach ($e in $receipt.created) {
  if ($e.status -eq "PENDING") {
    if (Test-EntryExists $e) { $e.status = "COMMITTED"; $kept += $e; Write-Host "  reconcile: PENDING→COMMITTED（実在・削除対象）$($e.kind) $($e.id)" }
    else { Write-Host "  reconcile: PENDING削除（未作成）$($e.kind) $($e.id)" }
  } else { $kept += $e }
}
$receipt.created = @($kept)
Save-Receipt $receipt

Write-Host ""
Write-Host "== 削除計画（receipt記載の自作リソース・自作bindingのみ。共有repo/Cloud Build bucketは保護） =="
foreach ($r in $receipt.created) {
  if ($r.kind -eq "iam-binding" -and $r.binding) { Write-Host ("  [解除] binding: {0} -> {1} @ {2}:{3}" -f $r.binding.member, $r.binding.role, $r.binding.targetKind, $r.binding.targetId) }
  elseif ($r.kind -eq "artifact-image") { Write-Host ("  [削除] image digest: {0}@{1}" -f $r.id, $r.digest) }
  else { Write-Host ("  [削除] {0}: {1}" -f $r.kind, $r.id) }
}
Write-Host "  [保護] Artifact Registry repo cloud-run-source-deploy / Cloud Build用bucket（共有・削除しない）"
Write-Host "  [手動] LINE WORKS Callback削除 / Gmail OAuth取消 + tokenファイル削除"
Write-Host ""
if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみで終了します（外部変更なし）"; exit 0 }
if (-not $AutoApprove) { $confirm = Read-Host "上記をすべて確認しました。削除を実行する場合は yes と入力してください"; if ($confirm -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 } }

$order = @{ "run-service" = 1; "iam-binding" = 2; "subscription" = 3; "topic" = 4; "secret" = 5; "bucket" = 6; "service-account" = 7; "artifact-image" = 8 }
$sorted = $receipt.created | Sort-Object { $order[$_.kind] }
foreach ($r in $sorted) {
  $kind = $r.kind; $id = $r.id
  switch ($kind) {
    "run-service" {
      $name = ($id -split "@")[0]
      if (Test-GCExists run services describe $name --region $Region) { Invoke-GC run services delete $name --project $ProjectId --region $Region --quiet }
      else { Write-Host "  skip: run-service $name（既に存在しない）" }
    }
    "iam-binding" {
      $b = $r.binding
      if (-not $b) { Write-Host "  skip: binding構造なし（旧形式）$id"; continue }
      # 完全一致（member/role/targetKind/targetId）で解除
      switch ($b.targetKind) {
        "topic" { if (Test-GCExists pubsub topics describe $b.targetId) { Invoke-GC pubsub topics remove-iam-policy-binding $b.targetId --project $ProjectId --member=$($b.member) --role=$($b.role) } else { Write-Host "  skip: binding対象topic消滅 $id" } }
        "subscription" { if (Test-GCExists pubsub subscriptions describe $b.targetId) { Invoke-GC pubsub subscriptions remove-iam-policy-binding $b.targetId --project $ProjectId --member=$($b.member) --role=$($b.role) } else { Write-Host "  skip: binding対象subscription消滅 $id" } }
        "secret" { if (Test-GCExists secrets describe $b.targetId) { Invoke-GC secrets remove-iam-policy-binding $b.targetId --project $ProjectId --member=$($b.member) --role=$($b.role) } else { Write-Host "  skip: binding対象secret消滅 $id" } }
        "bucket" {
          & gcloud storage buckets describe "gs://$($b.targetId)" --project $ProjectId *> $null
          if ($LASTEXITCODE -eq 0) { Invoke-GC storage buckets remove-iam-policy-binding "gs://$($b.targetId)" --project $ProjectId --member=$($b.member) --role=$($b.role) }
          else { Write-Host "  skip: binding対象bucket消滅 $id" }
        }
        "project" { Invoke-GC projects remove-iam-policy-binding $b.targetId --member=$($b.member) --role=$($b.role) --condition=None }
        "run-service" { Write-Host "  skip: run invoker bindingはサービス削除で消滅（$id）" }
        default { Write-Host "  skip: 未知のbinding対象 $id" }
      }
    }
    "subscription" { if (Test-GCExists pubsub subscriptions describe $id) { Invoke-GC pubsub subscriptions delete $id --project $ProjectId --quiet } else { Write-Host "  skip: subscription $id（既に存在しない）" } }
    "topic" { if (Test-GCExists pubsub topics describe $id) { Invoke-GC pubsub topics delete $id --project $ProjectId --quiet } else { Write-Host "  skip: topic $id（既に存在しない）" } }
    "secret" { if (Test-GCExists secrets describe $id) { Invoke-GC secrets delete $id --project $ProjectId --quiet } else { Write-Host "  skip: secret $id（既に存在しない）" } }
    "bucket" {
      if ($id -match "cloudbuild") { Write-Host "  protect: bucket $id（共有・削除しない）" }
      else {
        & gcloud storage buckets describe "gs://$id" --project $ProjectId *> $null
        if ($LASTEXITCODE -eq 0) { Invoke-GC storage rm --recursive "gs://$id" --project $ProjectId } else { Write-Host "  skip: bucket $id（既に存在しない）" }
      }
    }
    "service-account" { if (Test-GCExists iam service-accounts describe $id) { Invoke-GC iam service-accounts delete $id --project $ProjectId --quiet } else { Write-Host "  skip: service-account $id（既に存在しない）" } }
    "artifact-image" {
      if (-not $r.digest) { Write-Host "  skip: image digest未記録（path全体は削除しない）$id"; continue }
      & gcloud artifacts docker images describe "$id@$($r.digest)" --project $ProjectId *> $null
      if ($LASTEXITCODE -eq 0) { Invoke-GC artifacts docker images delete "$id@$($r.digest)" --project $ProjectId --delete-tags --quiet }
      else { Write-Host "  skip: image digest既に存在しない $id@$($r.digest)" }
    }
    default { Write-Host "  skip: 未知のkind $kind ($id)" }
  }
}

Write-Host "== 完了。receiptはロールバック記録として保持します（$ReceiptFile） =="
Write-Host "== 残る手動手順: LINE WORKS Callback削除 / Gmail OAuth取消 / PC側 stop-lcc-command.bat =="
