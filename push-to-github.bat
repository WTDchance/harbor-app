@echo off
echo ========================================
echo   Harbor - Push Conflict Fix to GitHub
echo ========================================
echo.

cd /d E:\Harbor\harbor-app

git add -A
git commit -m "fix: resolve merge conflict markers in health route"
git push origin main

echo.
echo DONE!
pause
