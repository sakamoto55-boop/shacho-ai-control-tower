@echo off
rem LCC COMMAND stop (Acceptance Correction 5)
rem Stops only the PID saved by start-lcc-command.bat. Never touches other node processes.
rem Runtime messages are ASCII only: cmd misparses multibyte UTF-8 batch lines.
cd /d "%~dp0"
if not exist lcc-command.pid (
  echo lcc-command.pid not found. The server is not running or was already stopped.
  pause
  exit /b 1
)
set LCC_PID=
set /p LCC_PID=<lcc-command.pid
if "%LCC_PID%"=="" (
  echo ERROR: lcc-command.pid is empty. Removing it.
  del lcc-command.pid
  pause
  exit /b 1
)

rem --- Kill only if the PID still belongs to a node process (PID reuse guard) ---
set PROCNAME=
for /f "usebackq" %%n in (`powershell -NoProfile -Command "(Get-Process -Id %LCC_PID% -ErrorAction SilentlyContinue).ProcessName"`) do set PROCNAME=%%n
if /i "%PROCNAME%"=="node" (
  taskkill /PID %LCC_PID% /F >nul
  echo Stopped the server process - PID %LCC_PID%.
) else if "%PROCNAME%"=="" (
  echo NOTE: process %LCC_PID% is not running. Removing the stale pid file.
) else (
  echo ERROR: PID %LCC_PID% now belongs to "%PROCNAME%", not node. Not killing it.
)
del lcc-command.pid

rem --- Verify port 8787 is closed ---
set PORTSTATE=unknown
for /f "usebackq" %%s in (`powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { 'open' } else { 'closed' }"`) do set PORTSTATE=%%s
if "%PORTSTATE%"=="closed" (
  echo Port 8787 is closed.
  pause
  exit /b 0
)
echo WARNING: port 8787 is still listening. Another process may own it.
pause
exit /b 1
