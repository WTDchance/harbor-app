@echo off
echo ========================================
echo   Harbor - Website Audit Fixes Batch 1
echo ========================================
echo.
echo  - Blog system + HIPAA page
echo  - Founding spots counter fix
echo  - Open Graph + Twitter cards + canonical URLs
echo  - GTM + Clarity placeholders
echo  - HIPAA language strengthened
echo  - Speed-to-lead stats added
echo  - Cost comparison section
echo  - Insurance verification feature card
echo  - Schema.org structured data
echo  - OG share image
echo.

cd /d E:\Harbor\harbor-app

git add -A
git commit -m "feat: website audit fixes - OG tags, SEO, HIPAA language, cost comparison, blog, analytics placeholders"
git push origin main

echo.
echo DONE! Railway will auto-deploy from main.
pause
