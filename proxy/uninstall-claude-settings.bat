@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
# Mid-weight uninstaller: removes the proxy keys from the `env` block in
# .claude\settings.json AND clears the matching persistent user env vars (so the
# Claude CLI actually stops routing through the proxy in new terminals). Does NOT
# touch the WinINET registry or any CA cert (see uninstall-claude-proxy.bat for
# the full teardown including Edge/Chrome ProxyOverride).
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$keysToRemove = @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY')

if (-not (Test-Path $settingsPath)) {
    Write-Host "No settings.json at $settingsPath - nothing to uninstall." -ForegroundColor Yellow
    return
}

$raw = Get-Content $settingsPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Host "settings.json is empty - nothing to uninstall." -ForegroundColor Yellow
    return
}

try {
    $settings = $raw | ConvertFrom-Json
} catch {
    Write-Error "Failed to parse $settingsPath as JSON. Fix it manually."
    return
}

$removed = @()

if ($settings.PSObject.Properties.Name -contains 'env') {
    $envBlock = $settings.env
    foreach ($key in $keysToRemove) {
        if ($envBlock.PSObject.Properties.Name -contains $key) {
            $envBlock.PSObject.Properties.Remove($key)
            $removed += $key
        }
    }
    # Drop the now-empty env block so we leave settings.json as clean as we found it.
    if ($envBlock.PSObject.Properties.Name.Count -eq 0) {
        $settings.PSObject.Properties.Remove('env')
    }
}

if ($removed.Count -gt 0) {
    $json      = $settings | ConvertTo-Json -Depth 20
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
}

# Clear the persistent user env vars too. These are what the Node-based Claude CLI
# actually reads (inherited by every new terminal), so settings.json alone is not
# enough to stop proxy routing. We intentionally leave the WinINET registry alone.
$envKeys    = @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY')
$clearedEnv = @()
foreach ($key in $envKeys) {
    if ([Environment]::GetEnvironmentVariable($key, 'User')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'User')
        $clearedEnv += $key
    }
}

Write-Host ""
Write-Host "  Claude settings.json proxy removed" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
if ($removed.Count -gt 0) {
    Write-Host "  settings.json keys removed: $($removed -join ', ')"
} else {
    Write-Host "  settings.json:              no proxy keys present"
}
Write-Host "  settings.json:              $settingsPath"
if ($clearedEnv.Count -gt 0) {
    Write-Host "  User env vars cleared:      $($clearedEnv -join ', ')"
} else {
    Write-Host "  User env vars:              none were set"
}
Write-Host "  WinINET registry:           left untouched (by design)"
Write-Host ""
Write-Host "  Open a NEW terminal (or restart VSCode) so the cleared env vars" -ForegroundColor Yellow
Write-Host "  take effect - already-open shells keep the old proxy values." -ForegroundColor Yellow
Write-Host "  Claude Code will then connect directly (no proxy)." -ForegroundColor Cyan
Write-Host "  To re-enable: double-click install-claude-settings.bat" -ForegroundColor DarkGray
Write-Host ""
