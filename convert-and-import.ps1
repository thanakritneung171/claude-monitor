# Convert PEM to DER and import

Write-Host "Converting PEM to DER format..." -ForegroundColor Cyan

$pemFile = "c:\Users\Thanakrit_C\Desktop\Log Prompt\claude-monitor\mitmproxy-ca.pem"
$derFile = "c:\Users\Thanakrit_C\Desktop\Log Prompt\claude-monitor\mitmproxy-ca.der"

# Read PEM file
$pemContent = Get-Content $pemFile -Raw

# Extract base64 content (between BEGIN and END)
$base64Content = $pemContent `
    -replace "-----BEGIN.*-----", "" `
    -replace "-----END.*-----", "" `
    -replace "\s", ""

# Convert base64 to bytes
$derBytes = [System.Convert]::FromBase64String($base64Content)

# Write DER file
[System.IO.File]::WriteAllBytes($derFile, $derBytes)

Write-Host "✅ Converted to DER: $derFile" -ForegroundColor Green

Write-Host ""
Write-Host "Importing DER certificate..." -ForegroundColor Cyan

try {
    Import-Certificate -FilePath $derFile -CertStoreLocation Cert:\CurrentUser\Root -ErrorAction Stop | Out-Null
    Write-Host "✅ SUCCESS: Certificate imported!" -ForegroundColor Green
} catch {
    Write-Host "❌ ERROR: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try alternative method:" -ForegroundColor Yellow
    Write-Host "  certutil -addstore Root ""$derFile""" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Cleanup..." -ForegroundColor Cyan
Remove-Item $derFile -Force -ErrorAction SilentlyContinue
Write-Host "✅ Done!" -ForegroundColor Green
