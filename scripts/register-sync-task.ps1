# LCC COMMAND 統合同期のWindowsタスク登録スクリプト（夜間統合運転 §14）
# 初期状態は「無効（Disabled）」で登録する = READY_TO_ENABLE。
# 有効化条件（すべて満たすまで Enable-ScheduledTask しないこと）:
#   - 対象connectorがLIVE_READ_ONLY
#   - secret storage検証済み / 二重起動防止済み（sync.lock実装済み）
#   - ログrotation確認 / sourceへ書き込みなし / 実データスモークテスト済み
# 実行間隔は正式な同期時刻設定が未確認のため、登録時は社長承認後に設定する。
param(
  [string]$WorkDir = (Split-Path $PSScriptRoot -Parent),
  [string]$TaskName = 'LCC_COMMAND_SyncIntegrations'
)

$npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $npx) { Write-Error 'npx が見つかりません'; exit 1 }

$action = New-ScheduledTaskAction -Execute $npx -Argument 'tsx scripts/sync-integrations.ts all' -WorkingDirectory $WorkDir
# トリガーは仮置き（毎日06:30）。有効化前に社長承認の時刻へ変更すること。
$trigger = New-ScheduledTaskTrigger -Daily -At 06:30
$settings = New-ScheduledTaskSettingsSet -DisallowDemandStart:$false -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'LCC COMMAND read-only統合同期（初期状態: 無効）' | Out-Null
Disable-ScheduledTask -TaskName $TaskName | Out-Null
Write-Output "登録完了（無効状態）: $TaskName — READY_TO_ENABLE。有効化は社長承認後に Enable-ScheduledTask -TaskName $TaskName"
