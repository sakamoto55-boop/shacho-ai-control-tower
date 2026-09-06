# DIOS: Windows / PowerShell 7 (Linux・macOS) 共通起動口。
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
# Windows版SDKとUnix版SDKを混同せず、実行対象をApplicationに限定する。
# 既存の所有権検査・承認・復旧処理は同じディレクトリのcoreスクリプトで維持する。
$ErrorActionPreference = "Stop"
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  $nativeGcloud = Get-Command gcloud -CommandType Application -ErrorAction Stop | Select-Object -First 1
  Set-Alias -Name gcloud.cmd -Value $nativeGcloud.Source -Scope Local
}
. (Join-Path $PSScriptRoot "gcloud-setup-realtime.core.ps1") @PSBoundParameters
