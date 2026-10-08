@echo off
setlocal
cd /d "%~dp0web"
where py >nul 2>nul
if %errorlevel%==0 (
  echo Starting Fairwork at http://localhost:8002
  start "Fairwork Server" cmd /k py -m http.server 8002
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    echo Starting Fairwork at http://localhost:8002
    start "Fairwork Server" cmd /k python -m http.server 8002
  ) else (
    echo Python was not found. Install Python 3 and run this file again.
    pause
    exit /b 1
  )
)
timeout /t 2 >nul
start "Fairwork" http://localhost:8002
endlocal
