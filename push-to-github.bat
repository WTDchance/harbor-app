@echo off
echo ========================================
echo   Harbor - Push Local Changes to GitHub
echo ========================================
echo.

echo Setting up git...
git config --global --add safe.directory E:/Harbor/harbor-app
git config --global user.email "chancewonser@gmail.com"
git config --global user.name "WTDchance"
echo.

cd /d E:\Harbor\harbor-app

echo Checking git status...
git status --short
echo.

echo Adding all changes...
git add -A
echo.

echo Committing...
git commit -m "security: add practice_id to intake submit patient update + verify-identity update (HIPAA isolation fix)"
echo.

echo Pushing to GitHub (main)...
git push origin main
echo.

echo ========================================
echo   DONE! Check Railway for green deploy.
echo ========================================
echo.
pause
