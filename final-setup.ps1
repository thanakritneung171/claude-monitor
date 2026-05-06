# Claude Monitor - Final Setup
# Run as: powershell -NoProfile -ExecutionPolicy Bypass -File final-setup.ps1

Write-Host "Claude Monitor - Final Setup" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

$ProxyHost = "127.0.0.1:8080"
$CertFile = "$PSScriptRoot\mitmproxy-ca.pem"

# Step 1: Set proxy environment variables
Write-Host "Step 1: Setting proxy environment variables..." -ForegroundColor Yellow
try {
    [Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://$ProxyHost", "User")
    [Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://$ProxyHost", "User")
    [Environment]::SetEnvironmentVariable("ALL_PROXY", "http://$ProxyHost", "User")
    Write-Host "✅ Proxy variables set in User registry" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Could not set via API: $_" -ForegroundColor Yellow
    Write-Host "Will use alternative method..." -ForegroundColor Yellow
}

# Also set for current session
$env:HTTP_PROXY = "http://$ProxyHost"
$env:HTTPS_PROXY = "http://$ProxyHost"
$env:ALL_PROXY = "http://$ProxyHost"

Write-Host "✅ Proxy variables set in current session" -ForegroundColor Green
Write-Host "   HTTP_PROXY = $env:HTTP_PROXY" -ForegroundColor Cyan
Write-Host "   HTTPS_PROXY = $env:HTTPS_PROXY" -ForegroundColor Cyan
Write-Host ""

# Step 2: Certificate
Write-Host "Step 2: Certificate status..." -ForegroundColor Yellow
if (Test-Path $CertFile) {
    Write-Host "✅ Certificate file found: $CertFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "Certificate installation requires Administrator." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  A) Right-click mitmproxy-ca.pem → Install Certificate" -ForegroundColor Gray
    Write-Host "     Choose: Current User → Trusted Root Certification Authorities" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  B) Run as Administrator:" -ForegroundColor Gray
    Write-Host "     Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command" -ForegroundColor Gray
    Write-Host "       \"Import-Certificate -FilePath " -ForegroundColor Gray
    Write-Host "       (Resolve-Path ''$CertFile'').Path -CertStoreLocation Cert:\CurrentUser\Root\"' -Verb RunAs" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "❌ Certificate file not found: $CertFile" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================" -ForegroundColor Cyan
Write-Host "SETUP SUMMARY" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Proxy configured:" -ForegroundColor Green
Write-Host "   HTTP_PROXY=http://127.0.0.1:8080" -ForegroundColor Cyan
Write-Host "   HTTPS_PROXY=http://127.0.0.1:8080" -ForegroundColor Cyan
Write-Host "   ALL_PROXY=http://127.0.0.1:8080" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Yellow
Write-Host "  1. Install certificate (see options above)" -ForegroundColor Gray
Write-Host "  2. Close Claude Desktop / Code / VSCode" -ForegroundColor Gray
Write-Host "  3. Restart them" -ForegroundColor Gray
Write-Host "  4. Test: curl -v https://api.anthropic.com" -ForegroundColor Gray
Write-Host ""
Write-Host "🔍 Monitor server:" -ForegroundColor Cyan
Write-Host "   docker logs -f claude-monitor-proxy" -ForegroundColor Gray
Write-Host ""

Write-Host "✅ Proxy setup is COMPLETE!" -ForegroundColor Green
Write-Host ""
