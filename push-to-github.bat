@echo off
echo ========================================
echo   Harbor - Push Health Check Fix
echo ========================================
echo.

cd /d E:\Harbor\harbor-app

git add -A
git commit -m "fix: health check now hits homepage instead of 404 auth/session endpoint"
git push origin main

echo.
echo DONE!
pause
