@echo off
rem LCC COMMAND 停止（ポート8787のNodeプロセスを終了）
echo LCC COMMAND を停止します...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8787 ^| findstr LISTENING') do taskkill /F /PID %%a
echo 停止しました。
pause
