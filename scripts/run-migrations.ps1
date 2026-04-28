# scripts/run-migrations.ps1
# Two-paste migration runner — prompts for harbor_access AND harbor_id cookies,
# then runs the migration script. The admin endpoint validates the ID token
# (harbor_id) to read the email for the admin-allowlist check, AND validates
# the access token (harbor_access) for session activeness. Both required.
#
# Usage from PowerShell in the repo root:
#   .\scripts\run-migrations.ps1

Write-Host "" 
Write-Host "==== Harbor Staging Migration Runner ====" -ForegroundColor Cyan
Write-Host ""
Write-Host "Steps:"
Write-Host "  1. Sign in to https://lab.harboroffice.ai/admin"
Write-Host "  2. F12 -> Application -> Cookies -> https://lab.harboroffice.ai"
Write-Host "  3. You will paste TWO cookies — harbor_access and harbor_id."
Write-Host ""

$accessCookie = Read-Host "harbor_access cookie value"
if ([string]::IsNullOrWhiteSpace($accessCookie)) {
    Write-Host "No harbor_access provided. Aborting." -ForegroundColor Red
    exit 1
}

$idCookie = Read-Host "harbor_id cookie value"
if ([string]::IsNullOrWhiteSpace($idCookie)) {
    Write-Host "No harbor_id provided. Aborting." -ForegroundColor Red
    exit 1
}

$env:HARBOR_ADMIN_COOKIE = "harbor_access=$accessCookie; harbor_id=$idCookie"

Write-Host ""
Write-Host "Running migrations..." -ForegroundColor Cyan
Write-Host ""

node "$PSScriptRoot/apply-migrations-via-admin.mjs"

Write-Host ""
Write-Host "If anything failed with 401, your cookies expired - re-run this script" -ForegroundColor Yellow
Write-Host "and paste fresh values for both." -ForegroundColor Yellow
