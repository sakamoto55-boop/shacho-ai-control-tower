# =============================================================================
# LCC COMMAND リアルタイム連携 teardownスクリプト（停止・削除・rollback）
# - resource receipt（data\gcloud-setup-receipt.json）に記録された自作リソース・自作IAM bindingのみ削除。
#   既存リソース・既存bindingは自作扱いしない（receiptに載っていないものへ触れない）。
# - 共有リソース（cloud-run-source-deploy repo・Cloud Build bucket）は丸ごと削除しない（relayイメージのみ削除）。
# - -PlanOnly は表示のみ。実削除は yes 明示入力（-AutoApproveはmock E2E検証用）。
# - 全コマンドへ --project を明示。全gcloud実行は $LASTEXITCODE を検査し失敗時は即停止。冪等（不存在はskip）。
# 停止のみの順序: 1) LINE WORKS ConsoleでCallback URL削除 2) 本スクリプト -StopOnly（invoker解除）
#   3) npm run gmail:authorize -- --stop 4) stop-lcc-command.bat
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "asia-northeast1",
  [string]$ReceiptFile = "",
  [switch]$PlanOnly,
  [switch]$StopOnly,
  [switch]$AutoApprove   # E2E検証用: yes確認を省略（本番では使わない）
)
$ErrorActionPreference = "Stop"
if (-not $ReceiptFile) { $ReceiptFile = Join-Path $PSScriptRoot "..\data\gcloud-setup-receipt.json" }

function Invoke-GC {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) {
    Write-Host "STOP: gcloud失敗（exit $LASTEXITCODE）: gcloud $($args -join ' ')"
    exit 1
  }
}
function Test-GCExists {
  & gcloud @args --project $ProjectId *> $null
  return ($LASTEXITCODE -eq 0)
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
  if (-not $AutoApprove) {
    $c = Read-Host "実行する場合は yes と入力してください"
    if ($c -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 }
  }
  Invoke-GC run services remove-iam-policy-binding lcc-lineworks-relay --project $ProjectId --region $Region --member="allUsers" --role="roles/run.invoker"
  Write-Host "== 完了: 公開Invoker解除 =="
  exit 0
}

if (-not (Test-Path $ReceiptFile)) {
  Write-Host "STOP: receiptが見つかりません（$ReceiptFile）。setup未実行、または -ReceiptFile を指定してください"
  exit 1
}
$receipt = Get-Content $ReceiptFile -Raw | ConvertFrom-Json
if ($receipt.projectId -ne $ProjectId) {
  Write-Host "STOP: receiptのprojectId（$($receipt.projectId)）と -ProjectId（$ProjectId）が一致しません"
  exit 1
}

Write-Host ""
Write-Host "== 削除計画（receipt記載の自作リソース・自作bindingのみ。共有repo/Cloud Build bucketは保護） =="
foreach ($r in $receipt.created) { Write-Host ("  [削除] {0}: {1}" -f $r.kind, $r.id) }
Write-Host "  [保護] Artifact Registry repo cloud-run-source-deploy / Cloud Build用bucket（共有・削除しない）"
Write-Host "  [手動] LINE WORKS Callback削除 / Gmail OAuth取消（myaccount.google.com/permissions）+ tokenファイル削除"
Write-Host ""
if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみで終了します（外部変更なし）"; exit 0 }
if (-not $AutoApprove) {
  $confirm = Read-Host "上記をすべて確認しました。削除を実行する場合は yes と入力してください"
  if ($confirm -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 }
}

# 削除順: run-service → iam-binding → subscription → topic → secret → bucket → service-account → artifact-image
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
      # id形式: <member>|<role>|<targetKind>:<targetId>。receipt記載＝setupが新規付与したbindingのみ解除
      $parts = $id -split "\|"
      if ($parts.Count -ne 3) { Write-Host "  skip: binding形式不明 $id"; continue }
      $member = $parts[0]; $role = $parts[1]; $target = $parts[2] -split ":", 2
      $memberArg = if ($member -eq "allUsers") { "allUsers" } elseif ($member -like "*@*") { "serviceAccount:$member" } else { $member }
      switch ($target[0]) {
        "topic" { if (Test-GCExists pubsub topics describe $target[1]) { Invoke-GC pubsub topics remove-iam-policy-binding $target[1] --project $ProjectId --member=$memberArg --role=$role } else { Write-Host "  skip: binding対象topic消滅 $id" } }
        "subscription" { if (Test-GCExists pubsub subscriptions describe $target[1]) { Invoke-GC pubsub subscriptions remove-iam-policy-binding $target[1] --project $ProjectId --member=$memberArg --role=$role } else { Write-Host "  skip: binding対象subscription消滅 $id" } }
        "secret" { if (Test-GCExists secrets describe $target[1]) { Invoke-GC secrets remove-iam-policy-binding $target[1] --project $ProjectId --member=$memberArg --role=$role } else { Write-Host "  skip: binding対象secret消滅 $id" } }
        "bucket" {
          & gcloud storage buckets describe "gs://$($target[1])" --project $ProjectId *> $null
          if ($LASTEXITCODE -eq 0) { Invoke-GC storage buckets remove-iam-policy-binding "gs://$($target[1])" --project $ProjectId --member=$memberArg --role=$role }
          else { Write-Host "  skip: binding対象bucket消滅 $id" }
        }
        "project" { Invoke-GC projects remove-iam-policy-binding $target[1] --member=$memberArg --role=$role --condition=None }
        "run-service" { Write-Host "  skip: run invoker bindingはサービス削除で消滅（$id）" }
        default { Write-Host "  skip: 未知のbinding対象 $id" }
      }
    }
    "subscription" {
      if (Test-GCExists pubsub subscriptions describe $id) { Invoke-GC pubsub subscriptions delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: subscription $id（既に存在しない）" }
    }
    "topic" {
      if (Test-GCExists pubsub topics describe $id) { Invoke-GC pubsub topics delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: topic $id（既に存在しない）" }
    }
    "secret" {
      if (Test-GCExists secrets describe $id) { Invoke-GC secrets delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: secret $id（既に存在しない）" }
    }
    "bucket" {
      if ($id -match "cloudbuild") { Write-Host "  protect: bucket $id（共有・削除しない）" }
      else {
        & gcloud storage buckets describe "gs://$id" --project $ProjectId *> $null
        if ($LASTEXITCODE -eq 0) { Invoke-GC storage rm --recursive "gs://$id" --project $ProjectId }
        else { Write-Host "  skip: bucket $id（既に存在しない）" }
      }
    }
    "service-account" {
      if (Test-GCExists iam service-accounts describe $id) { Invoke-GC iam service-accounts delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: service-account $id（既に存在しない）" }
    }
    "artifact-image" {
      & gcloud artifacts docker images list $id --project $ProjectId *> $null
      if ($LASTEXITCODE -eq 0) { Invoke-GC artifacts docker images delete $id --project $ProjectId --delete-tags --quiet }
      else { Write-Host "  skip: image $id（既に存在しない・共有repoは保護）" }
    }
    default { Write-Host "  skip: 未知のkind $kind ($id)" }
  }
}

Write-Host "== 完了。receiptはロールバック記録として保持します（$ReceiptFile） =="
Write-Host "== 残る手動手順: LINE WORKS Callback削除 / Gmail OAuth取消 / PC側 stop-lcc-command.bat =="
