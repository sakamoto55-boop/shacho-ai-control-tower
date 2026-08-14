# =============================================================================
# LCC COMMAND リアルタイム連携 teardownスクリプト（停止・削除・rollback）
# - resource receipt（data\gcloud-setup-receipt.json）に記録された自作リソースのみ削除する。
# - 共有リソース（cloud-run-source-deploy repository・Cloud Build bucket）は丸ごと削除しない
#   （relayイメージ=自作分のみ削除）。
# - -PlanOnly は表示のみ。実削除は `yes` の明示入力が必須。
# - 全コマンドへ --project を明示。冪等（既に存在しないものはskip）。
# 停止のみ（削除しない）の順序: 1) LINE WORKS ConsoleでCallback URL削除
#   2) allUsers invoker解除（本スクリプト -StopOnly） 3) npm run gmail:authorize -- --stop
#   4) stop-lcc-command.bat
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "asia-northeast1",
  [string]$ReceiptFile = "",
  [switch]$PlanOnly,
  [switch]$StopOnly   # 受信停止のみ（allUsers invoker解除+Gmail watch案内。削除はしない）
)
$ErrorActionPreference = "Stop"
if (-not $ReceiptFile) { $ReceiptFile = Join-Path $PSScriptRoot "..\data\gcloud-setup-receipt.json" }

function Test-Exists([string[]]$cmdArgs) {
  & gcloud @cmdArgs --project $ProjectId *> $null
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
  Write-Host "  [手動] LINE WORKS ConsoleのCallback URL削除 / npm run gmail:authorize -- --stop / stop-lcc-command.bat"
  if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみ"; exit 0 }
  $c = Read-Host "実行する場合は yes と入力してください"
  if ($c -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 }
  gcloud run services remove-iam-policy-binding lcc-lineworks-relay --project $ProjectId --region $Region `
    --member="allUsers" --role="roles/run.invoker"
  Write-Host "== 完了: 公開Invoker解除（relayは未認証アクセス不可） =="
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
$buildSa = "lcc-build@$ProjectId.iam.gserviceaccount.com"

Write-Host ""
Write-Host "== 削除計画（receipt記載の自作リソースのみ。共有repo/Cloud Build bucketは削除しない） =="
foreach ($r in $receipt.created) { Write-Host ("  [削除] {0}: {1}" -f $r.kind, $r.id) }
Write-Host "  [解除] $buildSa のproject-level 3ロール（logging.logWriter / artifactregistry.createOnPushWriter / storage.objectViewer）"
Write-Host "  [保護] Artifact Registry repo cloud-run-source-deploy（共有・削除しない。relayイメージのみ削除）"
Write-Host "  [保護] Cloud Build用bucket（共有・削除しない）"
Write-Host "  [手動] LINE WORKS ConsoleのCallback URL削除 / Gmail OAuth取消（myaccount.google.com/permissions）+ tokenファイル削除"
Write-Host ""
if ($PlanOnly) { Write-Host "-PlanOnly のため表示のみで終了します（外部変更なし）"; exit 0 }
$confirm = Read-Host "上記をすべて確認しました。削除を実行する場合は yes と入力してください"
if ($confirm -ne "yes") { Write-Host "中止しました（外部変更なし）"; exit 1 }

foreach ($r in $receipt.created) {
  $kind = $r.kind; $id = $r.id
  switch ($kind) {
    "run-service" {
      $name = ($id -split "@")[0]
      if (Test-Exists @("run", "services", "describe", $name, "--region", $Region)) {
        gcloud run services delete $name --project $ProjectId --region $Region --quiet
      } else { Write-Host "  skip: run-service $name（既に存在しない）" }
    }
    "subscription" {
      if (Test-Exists @("pubsub", "subscriptions", "describe", $id)) { gcloud pubsub subscriptions delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: subscription $id（既に存在しない）" }
    }
    "topic" {
      if (Test-Exists @("pubsub", "topics", "describe", $id)) { gcloud pubsub topics delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: topic $id（既に存在しない）" }
    }
    "secret" {
      if (Test-Exists @("secrets", "describe", $id)) { gcloud secrets delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: secret $id（既に存在しない）" }
    }
    "bucket" {
      if ($id -match "cloudbuild") { Write-Host "  protect: bucket $id（共有・削除しない）" }
      else {
        & gcloud storage buckets describe "gs://$id" --project $ProjectId *> $null
        if ($LASTEXITCODE -eq 0) { gcloud storage rm --recursive "gs://$id" --project $ProjectId }
        else { Write-Host "  skip: bucket $id（既に存在しない）" }
      }
    }
    "service-account" {
      if (Test-Exists @("iam", "service-accounts", "describe", $id)) { gcloud iam service-accounts delete $id --project $ProjectId --quiet }
      else { Write-Host "  skip: service-account $id（既に存在しない）" }
    }
    "artifact-image" {
      # 共有repoは保護し、relayイメージ（自作分）のみ削除
      & gcloud artifacts docker images list $id --project $ProjectId *> $null
      if ($LASTEXITCODE -eq 0) { gcloud artifacts docker images delete $id --project $ProjectId --delete-tags --quiet }
      else { Write-Host "  skip: image $id（既に存在しない）" }
    }
    default { Write-Host "  skip: 未知のkind $kind ($id)" }
  }
}

# build SAのproject-levelロール解除（SA削除後でもbinding除去は冪等）
foreach ($role in "roles/logging.logWriter", "roles/artifactregistry.createOnPushWriter", "roles/storage.objectViewer") {
  & gcloud projects remove-iam-policy-binding $ProjectId --member="serviceAccount:$buildSa" --role=$role --condition=None *> $null
  Write-Host "  removed（存在しなければno-op）: $buildSa -> $role"
}

Write-Host "== 完了。receiptはロールバック記録として保持します（$ReceiptFile） =="
Write-Host "== 残る手動手順: LINE WORKS Callback削除 / Gmail OAuth取消 / PC側 stop-lcc-command.bat =="
