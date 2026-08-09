@echo off
rem LCC COMMAND 停止（start時に保存したPIDのみを終了。他のnodeプロセスに触れない）
cd /d "%~dp0"
if not exist lcc-command.pid (
  echo lcc-command.pid が見つかりません。起動していないか、手動で終了済みです。
  pause
  exit /b 1
)
set /p LCC_PID=<lcc-command.pid
taskkill /PID %LCC_PID% /F && del lcc-command.pid && echo 停止しました（PID %LCC_PID%）。
pause
