@echo off
echo ============================================================
echo   Harbor EHR Dev Server (feature/ehr-v0 branch)
echo   Uses DB #2 (harbor-ehr-dev) - SAFE, does not touch prod
echo ============================================================
echo.
cd /d E:\Harbor\harbor-ehr
call npm run dev:ehr
pause
