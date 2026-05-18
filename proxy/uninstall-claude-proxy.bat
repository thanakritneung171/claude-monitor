@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$keysToRemove = @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS')

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
    if ($envBlock.PSObject.Properties.Name.Count -eq 0) {
        $settings.PSObject.Properties.Remove('env')
    }
}

if ($removed.Count -gt 0) {
    $json      = $settings | ConvertTo-Json -Depth 20
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
}

$envKeys = @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
             'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE')
$clearedEnv = @()
foreach ($key in $envKeys) {
    if ([Environment]::GetEnvironmentVariable($key, 'User')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'User')
        $clearedEnv += $key
    }
}

# Clear Windows system proxy bypass (WinINET ProxyOverride). install-claude-proxy
# sets this; on uninstall we wipe it back to empty so the registry is clean.
$regPath          = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$clearedBypass    = $false
$currentOverride  = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ProxyOverride
if ($currentOverride) {
    Set-ItemProperty -Path $regPath -Name ProxyOverride -Value ""
    $clearedBypass = $true
}

Write-Host ""
Write-Host "  Claude proxy config removed" -ForegroundColor Green
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
if ($clearedBypass) {
    Write-Host "  WinINET ProxyOverride:      cleared (was: $currentOverride)"
} else {
    Write-Host "  WinINET ProxyOverride:      already empty"
}
Write-Host ""
Write-Host "  Fully QUIT Claude Desktop and reopen for env changes to take effect." -ForegroundColor Yellow
Write-Host "  Claude tooling will now connect directly (no proxy)." -ForegroundColor Cyan
Write-Host "  To re-enable: double-click install-claude-proxy.bat" -ForegroundColor DarkGray
Write-Host ""
