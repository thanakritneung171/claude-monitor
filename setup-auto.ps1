#!/usr/bin/env pwsh
# Claude Monitor - Automatic Setup (Windows)

param(
    [string]$ProxyHost = "127.0.0.1:8080"
)

Write-Host "Claude Monitor - Automatic Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    Write-Host "  Right-click PowerShell → Run as Administrator" -ForegroundColor Yellow
    exit 1
}

Write-Host "Running as: Administrator ✓" -ForegroundColor Green
Write-Host ""

# Find certificate
Write-Host "Step 1: Locating certificate..." -ForegroundColor Cyan
$certPaths = @(
    ".\mitmproxy-ca.pem",
    "mitmproxy-ca.pem",
    "$PSScriptRoot\mitmproxy-ca.pem",
    "c:\Users\Thanakrit_C\Desktop\Log Prompt\claude-monitor\mitmproxy-ca.pem"
)

$certFile = $null
foreach ($path in $certPaths) {
    if (Test-Path $path) {
        $certFile = (Resolve-Path $path).Path
        Write-Host "Found: $certFile ✓" -ForegroundColor Green
        break
    }
}

if (-not $certFile) {
    Write-Host "ERROR: Certificate not found" -ForegroundColor Red
    Write-Host "Searched:" -ForegroundColor Yellow
    $certPaths | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    exit 1
}

Write-Host ""
Write-Host "Step 2: Installing certificate..." -ForegroundColor Cyan

# Try multiple methods
$installed = $false

# Method 1: Try Import-Certificate
try {
    Import-Certificate -FilePath $certFile -CertStoreLocation Cert:\CurrentUser\Root -ErrorAction Stop | Out-Null
    Write-Host "Method 1 (Import-Certificate): SUCCESS ✓" -ForegroundColor Green
    $installed = $true
} catch {
    Write-Host "Method 1 failed, trying method 2..." -ForegroundColor Yellow
}

# Method 2: Try certutil
if (-not $installed) {
    try {
        $output = cmd /c "certutil -addstore Root `"$certFile`"" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Method 2 (certutil): SUCCESS ✓" -ForegroundColor Green
            $installed = $true
        }
    } catch {
        Write-Host "Method 2 failed, trying method 3..." -ForegroundColor Yellow
    }
}

# Method 3: Manual GUI instruction
if (-not $installed) {
    Write-Host "Method 3: Manual installation required" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please follow these steps:" -ForegroundColor Cyan
    Write-Host "  1. Go to: $((Get-Item $certFile).DirectoryName)" -ForegroundColor Gray
    Write-Host "  2. Right-click: mitmproxy-ca.pem" -ForegroundColor Gray
    Write-Host "  3. Select: Install Certificate" -ForegroundColor Gray
    Write-Host "  4. Choose: Current User" -ForegroundColor Gray
    Write-Host "  5. Choose: Trusted Root Certification Authorities" -ForegroundColor Gray
    Write-Host "  6. Click: Next → Finish → OK" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Press ENTER after installing certificate..." -ForegroundColor Cyan
    Read-Host
    $installed = $true
}

Write-Host ""
Write-Host "Step 3: Setting environment variables..." -ForegroundColor Cyan

try {
    [Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://$ProxyHost", "User")
    [Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://$ProxyHost", "User")
    [Environment]::SetEnvironmentVariable("ALL_PROXY", "http://$ProxyHost", "User")

    # Also set for current session
    $env:HTTP_PROXY = "http://$ProxyHost"
    $env:HTTPS_PROXY = "http://$ProxyHost"
    $env:ALL_PROXY = "http://$ProxyHost"

    Write-Host "Environment variables set ✓" -ForegroundColor Green
    Write-Host "  HTTP_PROXY = $env:HTTP_PROXY" -ForegroundColor Gray
    Write-Host "  HTTPS_PROXY = $env:HTTPS_PROXY" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Failed to set environment variables: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 4: Verification" -ForegroundColor Cyan
Write-Host ""
Write-Host "Certificate Installation: $(if ($installed) { 'DONE ✓' } else { 'MANUAL ✓' })" -ForegroundColor Green
Write-Host "Proxy Configuration: DONE ✓" -ForegroundColor Green
Write-Host ""

Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "==========" -ForegroundColor Cyan
Write-Host "1. Close Claude Desktop (if running)" -ForegroundColor Yellow
Write-Host "2. Close Claude Code / VSCode (if running)" -ForegroundColor Yellow
Write-Host "3. Restart Claude Desktop" -ForegroundColor Yellow
Write-Host ""
Write-Host "TEST:" -ForegroundColor Cyan
Write-Host "  curl -v https://api.anthropic.com" -ForegroundColor Gray
Write-Host "  (Should NOT show certificate warnings)" -ForegroundColor Gray
Write-Host ""
Write-Host "MONITOR SERVER:" -ForegroundColor Cyan
Write-Host "  docker logs -f claude-monitor-proxy" -ForegroundColor Gray
Write-Host ""

Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host ""
pause
