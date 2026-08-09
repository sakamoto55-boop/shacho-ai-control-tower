@echo off
rem LCC COMMAND production起動（§検収5準拠: npm ci + production build + /health確認 + PID保存）
cd /d "%~dp0"
setlocal
if not exist logs mkdir logs

if not exist node_modules (
  echo 依存関係をインストールしています（初回のみ・数分）...
  call npm ci || goto :error
)

echo production buildを実行しています...
call npm run build || goto :error

echo サーバーを起動しています（production）...
for /f %%p in ('powershell -NoProfile -Command "$env:NODE_ENV='production'; (Start-Process node -ArgumentList 'dist/server.js' -PassThru -WindowStyle Hidden -RedirectStandardOutput 'logs/server.log' -RedirectStandardError 'logs/server.err.log').Id"') do set LCC_PID=%%p
echo %LCC_PID% > lcc-command.pid
echo PID %LCC_PID% を lcc-command.pid へ保存しました。

echo /health の応答を待っています...
set RETRY=0
:healthloop
set /a RETRY+=1
curl -s -o nul -w "" http://localhost:8787/health && goto :healthy
if %RETRY% GEQ 30 ( echo 起動確認に失敗しました。logs\server.err.log を確認してください。 & goto :error )
timeout /t 2 /nobreak > nul
goto :healthloop

:healthy
echo 起動を確認しました。ブラウザを開きます。
rem 初回はトークン付きで開く: start-lcc-command.bat の引数にトークンを渡すか、URL末尾に ?token=... を追記
if "%~1"=="" (
  start "" "http://localhost:8787/vui"
) else (
  start "" "http://localhost:8787/vui?token=%~1"
)
echo 停止は stop-lcc-command.bat を実行してください。
endlocal
exit /b 0

:error
echo 起動に失敗しました。
pause
exit /b 1
