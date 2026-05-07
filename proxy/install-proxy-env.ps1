#Requires -Version 5
# Install mitmproxy env vars at the USER level so VSCode / Claude Code CLI
# launched from explorer.exe (Start menu / shortcuts) pick them up.
#
# Run once:    .\install-proxy-env.ps1
# Undo:        .\install-proxy-env.ps1 -Uninstall
#
# After install: fully exit VSCode + Claude Desktop + close all "claude" terminals
# (taskkill /F /IM Code.exe & taskkill /F /IM claude.exe), then reopen.

[CmdletBinding()]
param([switch]$Uninstall)

$proxyUrl = "http://127.0.0.1:8080"
$caCert   = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"

$vars = @{
    "HTTPS_PROXY"         = $proxyUrl
    "HTTP_PROXY"          = $proxyUrl
    "ALL_PROXY"           = $proxyUrl
    "NO_PROXY"            = "localhost,127.0.0.1,::1,.local"
    "NODE_EXTRA_CA_CERTS" = $caCert
    "REQUESTS_CA_BUNDLE"  = $caCert
    "SSL_CERT_FILE"       = $caCert
    "NODE_USE_SYSTEM_CA"  = "1"
}

if ($Uninstall) {
    Write-Host ""
    Write-Host "  Removing User-level proxy env vars..." -ForegroundColor Yellow
    foreach ($k in $vars.Keys) {
        [Environment]::SetEnvironmentVariable($k, $null, "User")
        Write-Host "    cleared $k"
    }
    Write-Host ""
    Write-Host "  Done. Restart VSCode / terminals to pick up the change." -ForegroundColor Green
    Write-Host ""
    return
}

if (-not (Test-Path $caCert)) {
    Write-Error "CA cert not found at $caCert -- run mitmproxy at least once to generate it."
    return
}

Write-Host ""
Write-Host "  Installing User-level proxy env vars..." -ForegroundColor Cyan
foreach ($k in $vars.Keys) {
    [Environment]::SetEnvironmentVariable($k, $vars[$k], "User")
    Write-Host ("    {0,-20} = {1}" -f $k, $vars[$k])
}
Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "  Now FULLY exit VSCode + Claude Desktop + all 'claude' terminals," -ForegroundColor Yellow
Write-Host "  then reopen them. New processes will inherit the env vars." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Quick exit:" -ForegroundColor DarkGray
Write-Host "    taskkill /F /IM Code.exe ; taskkill /F /IM claude.exe" -ForegroundColor DarkGray
Write-Host ""
