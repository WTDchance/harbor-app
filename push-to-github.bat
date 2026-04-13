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
git commit -m "feat: uptime monitoring dashboard + health check APIs

- Add /api/admin/health endpoint (live service checks for Harbor, Vapi, Twilio, Supabase)
- Add /api/admin/health/history endpoint (uptime metrics, call stats, incidents)
- Add admin System Health dashboard (/admin/uptime) with auto-refresh
- SMS alerting on service downtime via Twilio
- Incident auto-creation on service down, auto-resolution on recovery
- Add System Health nav item to admin sidebar"
echo.

echo Pushing to GitHub (main)...
git push origin main
echo.

echo ========================================
echo   DONE! Check Railway for green deploy.
echo ========================================
echo.
pause
