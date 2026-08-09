@echo off
rem LCC COMMAND production起動（§検収5/9準拠）
cd /d "%~dp0"
setlocal enabledelayedexpansion
if not exist logs mkdir logs

rem --- Node.js 20以上の確認 ---
where node >nul 2>&1 || ( echo Node.jsが見つかりません。https://nodejs.org からLTS版をインストールしてください。 & pause & exit /b 1 )
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 ( echo Node.js 20以上が必要です（現在: v%NODEMAJOR%）。 & pause & exit /b 1 )

rem --- .env存在確認 ---
if not exist .env ( echo .env がありません。.env.example をコピーして設定してください（IT担当向け設定手順.md参照）。 & pause & exit /b 1 )

rem --- 認証トークン確認（未設定ならブラウザを開かず明示エラー） ---
set LCC_UI_TOKEN=%~1
if "%LCC_UI_TOKEN%"=="" if exist lcc-ui-token.txt set /p LCC_UI_TOKEN=<lcc-ui-token.txt
if "%LCC_UI_TOKEN%"=="" (
  echo 認証トークンが未設定です。以下のどちらかで指定してください:
  echo   1^) start-lcc-command.bat ^<トークン^>
  echo   2^) lcc-ui-token.txt にトークンを1行で保存
  echo トークンは .env の LCC_COMMAND_API_TOKENS に設定した値です。
  pause & exit /b 1
)

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

echo /health のHTTP 2xx応答を待っています...
set RETRY=0
:healthloop
set /a RETRY+=1
for /f %%c in ('curl -s -o nul -w "%%{http_code}" http://localhost:8787/health') do set HTTPCODE=%%c
if "%HTTPCODE:~0,1%"=="2" goto :healthy
if %RETRY% GEQ 30 ( echo 起動確認に失敗しました（HTTP %HTTPCODE%）。logs\server.err.log を確認してください。 & goto :error )
timeout /t 2 /nobreak > nul
goto :healthloop

:healthy
echo 起動を確認しました（HTTP %HTTPCODE%）。ブラウザを開きます。
start "" "http://localhost:8787/vui?token=%LCC_UI_TOKEN%"
echo （URLのトークンは画面表示後に自動で消去・保存されます）
echo 停止は stop-lcc-command.bat を実行してください。
endlocal
exit /b 0

:error
echo 起動に失敗しました。
pause
exit /b 1
