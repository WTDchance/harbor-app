# scripts/run-migrations.ps1
# One-paste migration runner — prompts for the harbor_access cookie,
# then runs the migration script. No env-var dance, no quoting issues.
#
# Usage from PowerShell in the repo root:
#   .\scripts\run-migrations.ps1

Write-Host "" 
Write-Host "==== Harbor Staging Migration Runner ====" -ForegroundColor Cyan
Write-Host ""
Write-Host "Steps:"
Write-Host "  1. Sign in to https://lab.harboroffice.ai/admin"
Write-Host "  2. F12 -> Application -> Cookies -> https://lab.harboroffice.ai"
Write-Host "  3. Copy the harbor_access cookie value"
Write-Host "  4. Paste it at the prompt below and press Enter"
Write-Host ""

$cookie = Read-Host "harbor_access cookie value"

if ([string]::IsNullOrWhiteSpace($cookie)) {
    Write-Host "No cookie provided. Aborting." -ForegroundColor Red
    exit 1
}

$env:HARBOR_ADMIN_COOKIE = $cookie

Write-Host ""
Write-Host "Running migrations..." -ForegroundColor Cyan
Write-Host ""

node "$PSScriptRoot/apply-migrations-via-admin.mjs"

Write-Host ""
Write-Host "Done. If anything failed with 401, your cookie expired mid-run -" -ForegroundColor Yellow
Write-Host "re-run this script and paste a fresh cookie." -ForegroundColor Yellow
