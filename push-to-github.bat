@echo off
echo ========================================
echo   Harbor - Push Blog + HIPAA Page
echo ========================================
echo.

cd /d E:\Harbor\harbor-app

git add -A
git commit -m "feat: add blog system with markdown posts, HIPAA compliance page, and nav/footer updates"
git push origin main

echo.
echo DONE!
pause
