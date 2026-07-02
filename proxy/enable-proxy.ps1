#Requires -Version 5
# Enable mitmproxy for Node.js / Claude Code CLI & VSCode in this PowerShell session.
# Usage:  . .\enable-proxy.ps1   (note the leading dot -- dot-sourcing)
#
# Claude Code CLI:       . .\enable-proxy.ps1  then  claude
# Claude Code VSCode:    . .\enable-proxy.ps1  then  code .   (launch VSCode from here)

$proxyUrl  = "http://10.10.84.1:8081"  # was: http://127.0.0.1:8080 (local)
$caCert    = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"

# Hosts that BYPASS the proxy (direct connection) so non-Claude apps don't break
# when off-VPN. NO_PROXY (comma list) covers env-var-aware tools; ProxyOverride
# (semicolon list; <local> = intranet/simple names) covers WinINET/system-proxy
# apps. Both match by host only — the whole host is bypassed, not a single path.
# NO_PROXY uses CIDR / dot-suffix (wildcards aren't portable across env-var
# tools); ProxyOverride uses WinINET wildcard syntax (* and <local>).
$noProxy       = "localhost,127.0.0.1,103.87.217.15,10.16.0.0/16,.dev.softdebut.com"
$proxyOverride = "localhost;127.0.0.1;103.87.217.15;10.16.*;*.dev.softdebut.com;<local>"

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
# Keep bypassed hosts (e.g. 103.87.217.15 credential check) on a direct connection
$env:NO_PROXY            = $noProxy

# Enable Windows System Proxy
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty -Path $regPath -Name ProxyEnable   -Value 1
Set-ItemProperty -Path $regPath -Name ProxyServer   -Value "$($proxyUrl -replace '^http://','')"
Set-ItemProperty -Path $regPath -Name ProxyOverride -Value $proxyOverride

Write-Host ""
Write-Host "  Proxy ENABLED for this session" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  HTTPS_PROXY         = $env:HTTPS_PROXY"
Write-Host "  NO_PROXY            = $env:NO_PROXY"
Write-Host "  NODE_EXTRA_CA_CERTS = $env:NODE_EXTRA_CA_CERTS"
Write-Host ""
Write-Host "  Claude Code CLI    ->  claude" -ForegroundColor Cyan
Write-Host "  Claude Code VSCode ->  code .  (launch VSCode from this terminal)" -ForegroundColor Cyan
Write-Host "  Disable:  . .\disable-proxy.ps1" -ForegroundColor DarkGray
Write-Host ""
