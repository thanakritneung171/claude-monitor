#Requires -Version 5
# Reverse install-claude-proxy.ps1:
#   1) Remove proxy + CA cert keys from Claude Code's settings.json (other keys preserved)
#   2) Clear persistent USER env vars used by Claude Desktop / Cowork
# Usage:
#     .\uninstall-claude-proxy.ps1
#
# After this, Claude tooling connects directly to Anthropic again
# (mitmproxy will no longer see its traffic).

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$keysToRemove = @('HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS')

if (-not (Test-Path $settingsPath)) {
    Write-Host "No settings.json at $settingsPath — nothing to uninstall." -ForegroundColor Yellow
    return
}

$raw = Get-Content $settingsPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Host "settings.json is empty — nothing to uninstall." -ForegroundColor Yellow
    return
}

try {
    $settings = $raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse $settingsPath as JSON. Fix it manually."
    return
}

if (-not ($settings.PSObject.Properties.Name -contains 'env')) {
    Write-Host "No 'env' block in settings.json — nothing to uninstall." -ForegroundColor Yellow
    return
}

$envBlock = $settings.env
$removed  = @()

foreach ($key in $keysToRemove) {
    if ($envBlock.PSObject.Properties.Name -contains $key) {
        $envBlock.PSObject.Properties.Remove($key)
        $removed += $key
    }
}

if ($removed.Count -eq 0) {
    Write-Host "No proxy keys found in env block — nothing to uninstall." -ForegroundColor Yellow
    return
}

# If env block is now empty, drop it entirely to keep settings.json tidy
if ($envBlock.PSObject.Properties.Name.Count -eq 0) {
    $settings.PSObject.Properties.Remove('env')
}

# Write back as UTF-8 without BOM
$json      = $settings | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)

# Also clear persistent user env vars set by install-claude-proxy.ps1
$envKeys = @('HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS',
             'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE')
$clearedEnv = @()
foreach ($key in $envKeys) {
    if ([Environment]::GetEnvironmentVariable($key, 'User')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'User')
        $clearedEnv += $key
    }
}

Write-Host ""
Write-Host "  Claude proxy config removed" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  settings.json keys removed: $($removed -join ', ')"
Write-Host "  settings.json:              $settingsPath"
if ($clearedEnv.Count -gt 0) {
    Write-Host "  User env vars cleared:      $($clearedEnv -join ', ')"
}
Write-Host ""
Write-Host "  Fully QUIT Claude Desktop and reopen for env changes to take effect." -ForegroundColor Yellow
Write-Host "  Claude tooling will now connect directly (no proxy)." -ForegroundColor Cyan
Write-Host "  To re-enable: .\install-claude-proxy.ps1" -ForegroundColor DarkGray
Write-Host ""
