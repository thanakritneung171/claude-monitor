#Requires -Version 5
# Enable mitmproxy for Node.js / Claude Code CLI & VSCode in this PowerShell session.
# Usage:  . .\enable-proxy.ps1   (note the leading dot -- dot-sourcing)
#
# Claude Code CLI:       . .\enable-proxy.ps1  then  claude
# Claude Code VSCode:    . .\enable-proxy.ps1  then  code .   (launch VSCode from here)

$proxyUrl  = "http://127.0.0.1:8080"
$caCert    = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"

if (-not (Test-Path $caCert)) {
    Write-Error "CA cert not found at $caCert -- run mitmproxy at least once to generate it."
    return
}

$env:HTTPS_PROXY         = $proxyUrl
$env:HTTP_PROXY          = $proxyUrl
$env:NODE_EXTRA_CA_CERTS = $caCert
# Tell Python (pip / requests / urllib3) about the cert too
$env:REQUESTS_CA_BUNDLE  = $caCert
$env:SSL_CERT_FILE       = $caCert

Write-Host ""
Write-Host "  Proxy ENABLED for this session" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  HTTPS_PROXY         = $env:HTTPS_PROXY"
Write-Host "  NODE_EXTRA_CA_CERTS = $env:NODE_EXTRA_CA_CERTS"
Write-Host ""
Write-Host "  Claude Code CLI    ->  claude" -ForegroundColor Cyan
Write-Host "  Claude Code VSCode ->  code .  (launch VSCode from this terminal)" -ForegroundColor Cyan
Write-Host "  Disable:  . .\disable-proxy.ps1" -ForegroundColor DarkGray
Write-Host ""
