# DIOS: Windows / PowerShell 7 (Linux・macOS) 共通起動口。
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = "asia-northeast1",
  [string]$ReceiptFile = "",
  [switch]$PlanOnly,
  [switch]$StopOnly,
  [switch]$AutoApprove
)
$ErrorActionPreference = "Stop"
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  $nativeGcloud = Get-Command gcloud -CommandType Application -ErrorAction Stop | Select-Object -First 1
  Set-Alias -Name gcloud.cmd -Value $nativeGcloud.Source -Scope Local
}
& (Join-Path $PSScriptRoot "gcloud-teardown-realtime.core.ps1") @PSBoundParameters
# 子スクリプトの明示的な停止コードを成功へ変換しない。
exit $LASTEXITCODE
