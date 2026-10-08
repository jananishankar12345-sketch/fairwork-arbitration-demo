@echo off
setlocal
cd /d "%~dp0web"
where py >nul 2>nul
if %errorlevel%==0 (
  echo Starting Fairwork Web3 at http://localhost:8003
  start "Fairwork Web3 Server" cmd /k py -m http.server 8003
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    echo Starting Fairwork Web3 at http://localhost:8003
    start "Fairwork Web3 Server" cmd /k python -m http.server 8003
  ) else (
    echo Python was not found. Install Python 3 and run this file again.
    pause
    exit /b 1
  )
)
timeout /t 2 >nul
start "Fairwork Web3" http://localhost:8003
endlocal
