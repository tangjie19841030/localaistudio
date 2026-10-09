@echo off
setlocal EnableExtensions
title Local AI UI Studio

rem ============================================================
rem  Local AI UI Studio launcher (single window)
rem  server:    http://127.0.0.1:8787
rem  workbench: http://localhost:5173
rem  usage:
rem    start-studio.bat          start both in this window, open page
rem    start-studio.bat stop     kill processes on 8787/5173/518x and exit
rem  Notes:
rem    - Pure ASCII (cmd + OEM codepage).
rem    - Chinese path safe (no nested cd quotes).
rem    - One console only: pnpm runs server+workbench in parallel here.
rem ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "PNPM=%USERPROFILE%\.local\pnpm\pnpm.cmd"
if not exist "%PNPM%" (
  echo [ERROR] pnpm shim not found: %PNPM%
  echo         Install pnpm under %USERPROFILE%\.local\pnpm first.
  pause
  exit /b 1
)

if /i "%~1"=="stop" goto :stop

rem --- refuse double-start: both ports already up -> just open browser ---
set "SRV=0"
set "WEB=0"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "SRV=1"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "WEB=1"
if "%SRV%"=="1" if "%WEB%"=="1" (
  echo [INFO] Server 8787 and workbench 5173 already running.
  start "" "http://localhost:5173"
  echo        To force a restart, run: start-studio.bat stop
  pause
  exit /b 0
)

rem --- partial leftovers (one of the two ports): free them so parallel bind succeeds ---
if "%SRV%"=="1" goto :clear_partial
if "%WEB%"=="1" goto :clear_partial
goto :after_clear
:clear_partial
echo [INFO] Partial instance found. Clearing leftover ports before a full start...
powershell -NoProfile -Command "$ports = @(8787,5173) + (5180..5199); foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }catch{} } }"
timeout /t 1 /nobreak >nul
:after_clear

rem --- install deps on first run ---
if not exist "%ROOT%\node_modules" (
  echo [SETUP] First run: installing dependencies - offline first...
  pushd "%ROOT%"
  call "%PNPM%" install --offline --config.proxy= --config.https-proxy= >nul 2>&1
  if errorlevel 1 (
    echo [SETUP] Offline install failed, retrying online...
    call "%PNPM%" install --config.proxy= --config.https-proxy=
    if errorlevel 1 (
      popd
      echo [ERROR] Dependency install failed. Check network / pnpm store.
      pause
      exit /b 1
    )
  )
  popd
)

echo [START] server + workbench in this window (Ctrl+C stops both)
echo         server    http://127.0.0.1:8787
echo         workbench http://localhost:5173
echo.

rem --- background: wait until both healthy, then open the browser once ---
start "" /b powershell -NoProfile -Command ^
  "$deadline=(Get-Date).AddSeconds(90); $okS=$false; $okW=$false;" ^
  "while((Get-Date) -lt $deadline){" ^
  "  if(-not $okS){ try{ $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ $okS=$true } }catch{} };" ^
  "  if(-not $okW){ try{ $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173' -TimeoutSec 2; if($r.StatusCode -eq 200){ $okW=$true } }catch{} };" ^
  "  if($okS -and $okW){ Start-Process 'http://localhost:5173'; exit 0 };" ^
  "  Start-Sleep -Milliseconds 800" ^
  "}; exit 1"

pushd "%ROOT%"
call "%PNPM%" --filter @studio/server --filter @studio/workbench --parallel run dev
set "DEV_EXIT=%ERRORLEVEL%"
popd

echo.
if not "%DEV_EXIT%"=="0" (
  echo [WARN] Dev processes exited with code %DEV_EXIT%.
) else (
  echo [INFO] Dev processes stopped.
)
echo        Cleanup leftover ports if needed: start-studio.bat stop
pause
exit /b 0

:stop
echo [STOP] killing processes on ports 8787 / 5173 / 5180-5199 ...
powershell -NoProfile -Command "$ports = @(8787,5173) + (5180..5199); foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output ('  killed pid ' + $_ + ' on port ' + $p) }catch{} } }"
echo [STOP] done.
pause
exit /b 0
