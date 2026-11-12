@echo off
setlocal
cd /d "%~dp0"
set "URL=http://127.0.0.1:18761"

if not exist "node_modules\kafkajs" (
  echo [KafkaDesk] First run: installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [KafkaDesk] npm install failed. Check your Node.js / network.
    pause
    exit /b 1
  )
)

curl -s -f -o NUL "%URL%/api/status"
if errorlevel 1 (
  echo [KafkaDesk] Starting local server...
  start "KafkaDesk Server" /min cmd /c "node server.js"
  for /L %%i in (1,1,10) do (
    "%SystemRoot%\System32\ping.exe" -n 2 127.0.0.1 >nul
    curl -s -f -o NUL "%URL%/api/status"
    if not errorlevel 1 goto :ready
  )
  echo [KafkaDesk] Server did not become ready. Check the server window.
  pause
  exit /b 1
)
:ready

set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if defined BROWSER (
  start "" "%BROWSER%" --app="%URL%" --window-size=1280,860 --no-first-run --no-default-browser-check --user-data-dir="%LOCALAPPDATA%\KafkaDesk\profile"
) else (
  start "" "%URL%"
)

endlocal
