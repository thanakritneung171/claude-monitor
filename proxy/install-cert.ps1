#Requires -RunAsAdministrator
# Install mitmproxy CA certificate into Windows Trusted Root store.
# Run once after first mitmproxy launch (which generates the cert).
$ErrorActionPreference = "Stop"

$certPath = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"

if (-not (Test-Path $certPath)) {
    Write-Host "Cert not found at: $certPath" -ForegroundColor Yellow
    Write-Host "Run start.ps1 once first (it generates the cert), then re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "Installing mitmproxy CA cert into Trusted Root..." -ForegroundColor Cyan
certutil -addstore -f Root $certPath

Write-Host ""
Write-Host "Done. All HTTPS traffic through the proxy will now be trusted." -ForegroundColor Green
Write-Host "Restart Claude Desktop / VS Code / terminal after installing." -ForegroundColor Yellow
