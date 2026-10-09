@echo off
setlocal
title Local AI UI Studio (Portable)

rem ============================================================
rem  Portable launcher - self-contained node + pnpm, zero install
rem  NOTE: keep this file pure ASCII (cmd parses BAT with OEM codepage)
rem ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "NODE=%ROOT%runtime\node.exe"
set "PNPM_CJS=%ROOT%runtime\pnpm\package\bin\pnpm.cjs"
if not exist "%NODE%" (
  echo [ERROR] missing %NODE%
  pause
  exit /b 1
)

rem pnpm shim: run pnpm.cjs with the bundled node
set "PNPM=%ROOT%runtime\pnpm.cmd"
> "%PNPM%" echo @echo off
>> "%PNPM%" echo "%NODE%" "%PNPM_CJS%" %%*

if /i "%~1"=="stop" goto :stop

rem --- port check: LISTENING only ---
powershell -NoProfile -Command "exit [int](-not [bool](Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue))" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Already running. Opening the page.
  start "" "http://localhost:5173"
  pause
  exit /b 0
)

echo [START] server 127.0.0.1:8787 + workbench localhost:5173
start "studio-server" cmd /k "cd /d "%ROOT%app\server" && "%NODE%" "%ROOT%app\server\node_modules\tsx\dist\cli.mjs" watch src/index.ts"
start "studio-workbench" cmd /k "cd /d "%ROOT%app\workbench" && "%NODE%" "%ROOT%app\workbench\node_modules\vite\bin\vite.js" --port 5173 --strictPort"

echo [WAIT] probing /api/health ...
powershell -NoProfile -Command "$d=(Get-Date).AddSeconds(90); while((Get-Date) -lt $d){ try{ $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } }catch{}; Start-Sleep -Milliseconds 800 }; exit 1" >nul 2>&1
if errorlevel 1 (
  echo [WARN] Not ready within 90s. Check the two windows.
  pause
  exit /b 1
)
start "" "http://localhost:5173"
echo.
echo Tip: server and workbench run in their own windows; closing stops them.
echo      To stop: run this file with the "stop" argument.
pause
exit /b 0

:stop
echo [STOP] killing studio processes ...
powershell -NoProfile -Command "$ports = @(8787,5173) + (5180..5199); foreach($p in $ports){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }catch{} } }"
echo [STOP] done.
pause
exit /b 0
