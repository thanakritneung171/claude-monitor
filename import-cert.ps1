# Import CA Certificate

Write-Host "Importing CA Certificate..." -ForegroundColor Cyan

$certFile = "c:\Users\Thanakrit_C\Desktop\Log Prompt\claude-monitor\mitmproxy-ca-cert.pem"

Write-Host "Certificate file: $certFile" -ForegroundColor Gray

try {
    Import-Certificate -FilePath $certFile -CertStoreLocation Cert:\CurrentUser\Root -ErrorAction Stop | Out-Null
    Write-Host "✅ SUCCESS: Certificate imported to Trusted Root!" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Trying alternative method..." -ForegroundColor Yellow
    certutil -addstore Root $certFile
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ SUCCESS: Certificate imported!" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ Done!" -ForegroundColor Green
