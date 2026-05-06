# Stop mitmproxy and clear proxy settings for Git

Write-Host "Stopping mitmproxy..." -ForegroundColor Yellow

# Kill mitmproxy processes
$processes = @("mitmproxy", "mitmdump", "mitmweb")
foreach ($proc in $processes) {
    $found = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($found) {
        Stop-Process -Name $proc -Force
        Write-Host "  Stopped: $proc" -ForegroundColor Green
    }
}

# Clear User-level environment variables (permanent)
[System.Environment]::SetEnvironmentVariable("HTTP_PROXY", $null, "User")
[System.Environment]::SetEnvironmentVariable("HTTPS_PROXY", $null, "User")
[System.Environment]::SetEnvironmentVariable("http_proxy", $null, "User")
[System.Environment]::SetEnvironmentVariable("https_proxy", $null, "User")

# Clear current session environment variables
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""

Write-Host "Proxy settings cleared." -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Restart VS Code before doing git push/sync." -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
