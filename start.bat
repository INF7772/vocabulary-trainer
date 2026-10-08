@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the current Node.js LTS release and run start.bat again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Repair the Node.js installation and run start.bat again.
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

echo Starting Vocabulary Trainer at http://127.0.0.1:5173/
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort --open
if errorlevel 1 (
  echo The development server could not start. Port 5173 may already be in use.
  pause
  exit /b 1
)

