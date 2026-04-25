@echo off
echo ============================================================
echo   Harbor EHR Dev Server (feature/ehr-v0 branch)
echo   Uses DB #2 (harbor-ehr-dev) - SAFE, does not touch prod
echo ============================================================
echo.
echo Cleaning up any stale dev server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
  echo Killing stale process PID %%a on port 3000
  taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo.
cd /d E:\Harbor\harbor-ehr
call npm run dev:ehr
pause
