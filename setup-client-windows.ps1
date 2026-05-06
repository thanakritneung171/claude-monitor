#!/usr/bin/env pwsh
# Claude Monitor Client Setup (Windows)

param(
    [string]$CertFile = "mitmproxy-ca.pem",
    [string]$ProxyServer = "http://localhost:8080"
)

Write-Host "Claude Monitor Client Setup (Windows)" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify certificate file
if (-not (Test-Path $CertFile)) {
    Write-Host "ERROR: Certificate file not found: $CertFile" -ForegroundColor Red
    Write-Host "Get it from server: docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem" -ForegroundColor Yellow
    exit 1
}

Write-Host "Step 1: Installing CA Certificate" -ForegroundColor Cyan
Write-Host "This requires administrator privileges..."
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must run as Administrator" -ForegroundColor Red
    Write-Host "Re-run: Right-click PowerShell → Run as Administrator" -ForegroundColor Yellow
    exit 1
}

# Import certificate
try {
    Import-Certificate -FilePath (Resolve-Path $CertFile) -CertStoreLocation Cert:\CurrentUser\Root -ErrorAction Stop | Out-Null
    Write-Host "SUCCESS: Certificate installed to Trusted Root" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to import certificate: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Setting Proxy Environment Variables" -ForegroundColor Cyan

$proxyHost = $ProxyServer -replace "^https?://", ""
Write-Host "Proxy: $proxyHost" -ForegroundColor Cyan

try {
    [Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://$proxyHost", "User")
    [Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://$proxyHost", "User")
    [Environment]::SetEnvironmentVariable("ALL_PROXY", "http://$proxyHost", "User")
    Write-Host "SUCCESS: Environment variables set" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to set environment variables: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 3: Verify" -ForegroundColor Cyan
$env:HTTP_PROXY = "http://$proxyHost"
$env:HTTPS_PROXY = "http://$proxyHost"

Write-Host "HTTP_PROXY = $env:HTTP_PROXY" -ForegroundColor Cyan
Write-Host "HTTPS_PROXY = $env:HTTPS_PROXY" -ForegroundColor Cyan

Write-Host ""
Write-Host "Step 4: Restart Applications" -ForegroundColor Cyan
Write-Host "Close and restart:" -ForegroundColor Yellow
Write-Host "  - Claude Desktop" -ForegroundColor Yellow
Write-Host "  - Claude Code CLI/VSCode" -ForegroundColor Yellow
Write-Host "  - Any other Claude clients" -ForegroundColor Yellow

Write-Host ""
Write-Host "Step 5: Test" -ForegroundColor Cyan
Write-Host "In PowerShell, test:" -ForegroundColor Yellow
Write-Host "  curl -v https://api.anthropic.com" -ForegroundColor Gray
Write-Host "  (Should NOT show certificate warnings)" -ForegroundColor Gray

Write-Host ""
Write-Host "DONE! Setup complete." -ForegroundColor Green
Write-Host ""
pause
