@echo off
setlocal
echo ==========================================================
echo   Harbor Supabase CLI - one-time setup for schema mirror
echo ==========================================================
echo.
echo This does three things:
echo   1. Logs you in to Supabase (browser will open)
echo   2. Links this folder to your prod project
echo   3. Dumps the prod schema to supabase\prod-schema.sql
echo.
echo During step 2 you'll be asked for your prod DATABASE PASSWORD.
echo (Find it at: Supabase dashboard -^> prod project -^> Project
echo Settings -^> Database -^> Database password.)
echo.
echo Press any key to begin...
pause >nul

cd /d E:\Harbor\harbor-ehr

echo.
echo ---[ Step 1 of 3: Supabase login ]---
call npx -y supabase login
if errorlevel 1 goto :failed

echo.
echo ---[ Step 2 of 3: Link to prod project ]---
call npx -y supabase link --project-ref oubmpjtbbobiuzumagec
if errorlevel 1 goto :failed

echo.
echo ---[ Step 3 of 3: Dump prod schema ]---
call npx -y supabase db dump --linked --schema public -f supabase\prod-schema.sql
if errorlevel 1 goto :failed

echo.
if exist supabase\prod-schema.sql (
    echo ==========================================================
    echo   SUCCESS
    echo ==========================================================
    echo   Prod schema saved to: supabase\prod-schema.sql
    echo   Tell Claude it is done - he will apply it to DB #2.
    echo ==========================================================
    goto :end
)

:failed
echo.
echo Something went wrong. Copy the messages above and share with Claude.

:end
echo.
pause
endlocal
