@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the current Node.js LTS release and run build.bat again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Repair the Node.js installation and run build.bat again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed. Review the messages above.
    pause
    exit /b 1
  )
)

echo Building Vocabulary Trainer...
call npm.cmd run build
if errorlevel 1 (
  echo Production build failed. Review the messages above.
  pause
  exit /b 1
)

echo Build complete. Static production files are in: %~dp0dist
pause
