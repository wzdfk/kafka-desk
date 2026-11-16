@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "GH="
if exist "%ProgramFiles%\GitHub CLI\gh.exe" set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
if not defined GH if exist "%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe" set "GH=%LOCALAPPDATA%\Programs\GitHub CLI\gh.exe"
if not defined GH set "GH=gh"

if /i "%~1"=="--help" goto :help
if /i "%~1"=="--dry-run" goto :dryrun

echo.
echo ==========================================
echo  KafkaDesk - publish a GitHub Release
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  goto :fail
)

echo [1/5] Checking GitHub CLI login...
"%GH%" auth status >nul 2>nul
if errorlevel 1 (
  echo [ERROR] gh is not logged in. Run once: gh auth login
  goto :fail
)

echo [2/5] Offline self-check...
call npm run verify:update
if errorlevel 1 (
  echo.
  echo [WARN] verify:update reported failures.
  choice /c YN /n /m "Continue anyway? [Y/N] "
  if errorlevel 2 goto :fail
)

echo.
echo [3/5] Pending changes (will be committed by the release script):
git status --short
echo.

echo [4/5] Pick version bump:
echo   1 = patch  (bug fix,     1.0.1 -^> 1.0.2)
echo   2 = minor  (new feature, 1.0.1 -^> 1.1.0)
echo   3 = major  (breaking,    1.0.1 -^> 2.0.0)
echo   4 = custom (type an exact version, must be greater than current)
choice /c 1234 /n /m "Select [1-4]: "
if errorlevel 4 (
  set "MODE=custom"
) else if errorlevel 3 (
  set "MODE=major"
) else if errorlevel 2 (
  set "MODE=minor"
) else (
  set "MODE=patch"
)

set "RELARGS="
if /i "%MODE%"=="custom" (
  node -p "require('./package.json').version" > "%TEMP%\kd-cur.txt"
  set /p CUR=<"%TEMP%\kd-cur.txt"
  del "%TEMP%\kd-cur.txt" >nul 2>&1
  echo.
  echo Current version: !CUR!
  set /p "TARGET=Target version (e.g. 1.1.0): "
  if "!TARGET!"=="" goto :cancel
  set "RELARGS=--version !TARGET! --publish"
) else (
  set "RELARGS=%MODE% --publish"
)

echo.
echo Release args: %RELARGS%
echo This will: bump version, build web + portable exe, commit ALL changes,
echo push tag, and create the GitHub Release with exe + sha256.
choice /c YN /n /m "Proceed? [Y/N] "
if errorlevel 2 goto :cancel

echo.
echo [5/5] Building and publishing...
call npm run release -- %RELARGS%
if errorlevel 1 goto :publish_failed

node -p "require('./package.json').version" > "%TEMP%\kd-version.txt"
set /p VER=<"%TEMP%\kd-version.txt"
del "%TEMP%\kd-version.txt" >nul 2>&1

echo.
echo [OK] Released v%VER%
"%GH%" release view v%VER%
echo.
pause
exit /b 0

:publish_failed
echo.
echo [ERROR] Release failed. If the tag was already pushed, only the upload failed.
echo Retry the upload with:
echo   "%GH%" release create vX.Y.Z kafka_app\KafkaDesk-X.Y.Z-portable.exe kafka_app\KafkaDesk-X.Y.Z-portable.exe.sha256 --generate-notes
echo If the tag already exists: add --verify-tag
goto :fail

:dryrun
set "MODE=%~2"
if not defined MODE set "MODE=patch"
if /i "%MODE%"=="baseline" goto :dry_mode
if /i "%MODE%"=="patch" goto :dry_mode
if /i "%MODE%"=="minor" goto :dry_mode
if /i "%MODE%"=="major" goto :dry_mode
echo [DRY-RUN] version=%MODE% (no files written, nothing pushed)
call npm run release -- --version %MODE% --dry-run
goto :dry_end

:dry_mode
echo [DRY-RUN] mode=%MODE% (no files written, nothing pushed)
call npm run release -- %MODE% --dry-run

:dry_end
echo.
pause
exit /b 0

:help
echo Usage:
echo   release.bat                     interactive release (patch/minor/major/custom)
echo   release.bat --dry-run patch     preview only
echo   release.bat --dry-run 1.1.0     preview an exact version
echo.
echo Exact version rule: must be greater than the current version, tag must not exist.
echo Version bump is handled by tools/release.mjs; do NOT edit package.json by hand.
exit /b 0

:cancel
echo.
echo Cancelled. Nothing was changed.
pause
exit /b 1

:fail
echo.
pause
exit /b 1
