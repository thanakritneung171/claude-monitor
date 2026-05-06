#!/usr/bin/env pwsh
# Claude Monitor Client Setup (Windows)

param(
    [string]$CertFile = "mitmproxy-ca.pem",
    [string]$ProxyServer = "http://localhost:8080"
)

Write-Host "Claude Monitor Client Setup (Windows)" -ForegroundColor Cyan
Write-Host ""

# Step 0: Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must run as Administrator" -ForegroundColor Red
    Write-Host "Re-run: Right-click PowerShell → Run as Administrator" -ForegroundColor Yellow
    exit 1
}

# Step 1: Verify certificate file
Write-Host "Step 1: Verifying Certificate" -ForegroundColor Cyan

# Try multiple path resolutions
$certPath = $null
if (Test-Path $CertFile -PathType Leaf) {
    $certPath = (Resolve-Path $CertFile).Path
    Write-Host "Found: $certPath" -ForegroundColor Green
} else {
    Write-Host "ERROR: Certificate file not found: $CertFile" -ForegroundColor Red
    Write-Host "" -ForegroundColor Yellow
    Write-Host "Check:" -ForegroundColor Yellow
    Write-Host "  1. File exists: ls mitmproxy-ca.pem" -ForegroundColor Gray
    Write-Host "  2. You're in correct directory: cd $PWD" -ForegroundColor Gray
    Write-Host "  3. Get from server if missing:" -ForegroundColor Gray
    Write-Host "     docker cp claude-monitor-proxy:/root/.mitmproxy/mitmproxy-ca.pem ." -ForegroundColor Gray
    exit 1
}

# Verify it's a valid certificate
Write-Host "Validating certificate..." -ForegroundColor Cyan
try {
    $certContent = Get-Content $certPath -Raw
    if (-not ($certContent -match "BEGIN.*PRIVATE KEY") -and -not ($certContent -match "BEGIN CERTIFICATE")) {
        Write-Host "ERROR: File is not a valid certificate" -ForegroundColor Red
        exit 1
    }
    Write-Host "Certificate is valid" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Cannot read certificate: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Installing CA Certificate to Trusted Root" -ForegroundColor Cyan
Write-Host "You may see a security prompt..." -ForegroundColor Yellow
Write-Host ""

# Import certificate
try {
    # Method 1: Try Import-Certificate (newer)
    $cert = Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\CurrentUser\Root -WarningAction SilentlyContinue -ErrorAction Stop
    Write-Host "SUCCESS: Certificate installed to Trusted Root" -ForegroundColor Green
    Write-Host "Thumbprint: $($cert.Thumbprint)" -ForegroundColor Gray
} catch {
    # Method 2: Try alternative method using certutil
    Write-Host "Trying alternative method..." -ForegroundColor Yellow
    try {
        # For PEM files, might need to convert to DER first
        certutil -addstore Root $certPath 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SUCCESS: Certificate installed using certutil" -ForegroundColor Green
        } else {
            Write-Host "ERROR: Failed to import certificate: $_" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "ERROR: Failed to import certificate: $_" -ForegroundColor Red
        Write-Host "" -ForegroundColor Yellow
        Write-Host "Try manually:" -ForegroundColor Yellow
        Write-Host "  1. Right-click mitmproxy-ca.pem" -ForegroundColor Gray
        Write-Host "  2. Select 'Install Certificate'" -ForegroundColor Gray
        Write-Host "  3. Choose: Current User → Trusted Root Certification Authorities" -ForegroundColor Gray
        exit 1
    }
}

Write-Host ""
Write-Host "Step 3: Setting Proxy Environment Variables" -ForegroundColor Cyan

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
Write-Host "Step 4: Verify" -ForegroundColor Cyan
$env:HTTP_PROXY = "http://$proxyHost"
$env:HTTPS_PROXY = "http://$proxyHost"

Write-Host "HTTP_PROXY = $env:HTTP_PROXY" -ForegroundColor Cyan
Write-Host "HTTPS_PROXY = $env:HTTPS_PROXY" -ForegroundColor Cyan

Write-Host ""
Write-Host "Step 5: Restart Applications" -ForegroundColor Cyan
Write-Host "Close and restart:" -ForegroundColor Yellow
Write-Host "  - Claude Desktop" -ForegroundColor Yellow
Write-Host "  - Claude Code CLI/VSCode" -ForegroundColor Yellow
Write-Host "  - Any other Claude clients" -ForegroundColor Yellow

Write-Host ""
Write-Host "Step 6: Test" -ForegroundColor Cyan
Write-Host "In PowerShell, test:" -ForegroundColor Yellow
Write-Host "  curl -v https://api.anthropic.com" -ForegroundColor Gray
Write-Host "  (Should NOT show certificate warnings)" -ForegroundColor Gray

Write-Host ""
Write-Host "DONE! Setup complete." -ForegroundColor Green
Write-Host ""
pause
