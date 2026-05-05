#Requires -Version 5
# Disable proxy env vars in this session.
# Usage:  . .\disable-proxy.ps1   (dot-sourced)

$env:HTTPS_PROXY         = ""
$env:HTTP_PROXY          = ""
$env:NODE_EXTRA_CA_CERTS = ""
$env:REQUESTS_CA_BUNDLE  = ""
$env:SSL_CERT_FILE       = ""

Write-Host "  Proxy DISABLED for this session" -ForegroundColor Yellow
