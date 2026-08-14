@echo off
rem LCC COMMAND production start (Acceptance Correction 5: Windows entrypoint reliability)
rem Runtime messages are ASCII only: cmd misparses multibyte UTF-8 batch lines
rem and can execute message fragments as commands.
cd /d "%~dp0"
setlocal enabledelayedexpansion
if not exist logs mkdir logs

rem --- Require Node.js 20+ ---
where node >nul 2>&1 || ( echo ERROR: Node.js not found. Install the LTS build from https://nodejs.org & pause & exit /b 1 )
set NODEMAJOR=0
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if "%NODEMAJOR%"=="" set NODEMAJOR=0
if %NODEMAJOR% LSS 20 ( echo ERROR: Node.js 20 or later is required. Current major version: %NODEMAJOR% & pause & exit /b 1 )

rem --- Require .env ---
if not exist .env ( echo ERROR: .env not found. Extract LCC_COMMAND_LOCAL_CONFIG.zip into this folder. & pause & exit /b 1 )

rem --- Require UI token (do not open the browser without it) ---
set LCC_UI_TOKEN=%~1
if "%LCC_UI_TOKEN%"=="" if exist lcc-ui-token.txt set /p LCC_UI_TOKEN=<lcc-ui-token.txt
if "%LCC_UI_TOKEN%"=="" (
  echo ERROR: UI token not set. Provide it one of these ways:
  echo   1^) start-lcc-command.bat ^<token^>
  echo   2^) save the token as a single line in lcc-ui-token.txt
  echo The token must match a value of LCC_COMMAND_API_TOKENS in .env
  pause & exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - first run only, takes a few minutes...
  call npm ci || goto :error
)

echo Running production build...
call npm run build || goto :error

echo Starting server - production mode...
rem PID is handed over via lcc-command.pid, not via a for /f pipe:
rem the spawned node inherits the pipe handle, so a for /f would stay
rem blocked for as long as the server lives.
powershell -NoProfile -Command "$env:NODE_ENV='production'; (Start-Process node -ArgumentList 'dist/server.js' -PassThru -WindowStyle Hidden -RedirectStandardOutput 'logs/server.log' -RedirectStandardError 'logs/server.err.log').Id | Out-File -Encoding ascii 'lcc-command.pid'"
set LCC_PID=
if exist lcc-command.pid set /p LCC_PID=<lcc-command.pid
if "%LCC_PID%"=="" ( echo ERROR: could not capture the server PID. & goto :error )
echo Saved PID %LCC_PID% to lcc-command.pid

echo Waiting for HTTP 2xx from /health ...
set RETRY=0
:healthloop
set /a RETRY+=1
set HTTPCODE=000
for /f "usebackq" %%c in (`curl -s -o nul -w "%%{http_code}" http://localhost:8787/health`) do set HTTPCODE=%%c
if "%HTTPCODE:~0,1%"=="2" goto :healthy
if %RETRY% GEQ 30 ( echo ERROR: health check failed - HTTP %HTTPCODE%. See logs\server.err.log & goto :error )
rem ping is used as a 2s wait: "timeout" aborts when stdin is not a console.
ping -n 3 127.0.0.1 > nul
goto :healthloop

:healthy
rem --- Optional realtime subscribers (set LCC_SUBSCRIBERS=true in .env) ---
rem Start-Process cannot resolve npx (a .cmd shim) on Windows, so run tsx via node directly.
rem Honest reporting: only claim "started" when the PID was actually captured.
findstr /b /c:"LCC_SUBSCRIBERS=true" .env >nul 2>&1
if not errorlevel 1 (
  powershell -NoProfile -Command "(Start-Process node -ArgumentList 'node_modules/tsx/dist/cli.mjs','scripts/run-subscribers.ts' -PassThru -WindowStyle Hidden -RedirectStandardOutput 'logs/subscribers.log' -RedirectStandardError 'logs/subscribers.err.log').Id | Out-File -Encoding ascii 'subscribers.pid'"
  set SUB_STARTED=
  if exist subscribers.pid set /p SUB_STARTED=<subscribers.pid
  if "!SUB_STARTED!"=="" (
    echo WARNING: realtime subscribers did NOT start - see logs\subscribers.err.log
  ) else (
    echo Realtime subscribers started - PID !SUB_STARTED! saved to subscribers.pid
  )
)
echo Server is up - HTTP %HTTPCODE%. Opening the browser.
start "" "http://localhost:8787/vui?token=%LCC_UI_TOKEN%"
echo (The URL token is cleared and stored automatically after the page opens)
echo To stop the server: run stop-lcc-command.bat
endlocal
exit /b 0

:error
echo Startup failed.
pause
exit /b 1
