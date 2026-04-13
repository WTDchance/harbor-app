@echo off
echo ========================================
echo   Harbor - Push HIPAA Page + Footer Link
echo ========================================
echo.

cd /d E:\Harbor\harbor-app

git add -A
git commit -m "feat: add HIPAA compliance page and footer link"
git push origin main

echo.
echo DONE!
pause
