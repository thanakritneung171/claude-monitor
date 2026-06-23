@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
# Mid-weight installer: edits the `env` block in .claude\settings.json AND sets the
# matching persistent user env vars so the Node-based Claude CLI routes through the
# monitoring proxy in new terminals. Does NOT touch the WinINET registry or
# generate/install any CA cert (see install-claude-proxy.bat for the full setup).
$proxyUrl     = "http://10.10.84.1:8081"
$proxyBypass  = "10.16.0.0/16,localhost,127.0.0.1"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

$claudeDir = Split-Path $settingsPath -Parent
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $settings = [PSCustomObject]@{}
    } else {
        try {
            $settings = $raw | ConvertFrom-Json
        } catch {
            Write-Error "Failed to parse $settingsPath as JSON. Fix or remove it, then re-run."
            return
        }
    }
} else {
    $settings = [PSCustomObject]@{}
}

function Set-Prop {
    param($Object, [string]$Name, $Value)
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

if ($settings.PSObject.Properties.Name -contains 'env') {
    $envBlock = $settings.env
} else {
    $envBlock = [PSCustomObject]@{}
    Set-Prop $settings 'env' $envBlock
}

Set-Prop $envBlock 'HTTPS_PROXY' $proxyUrl
Set-Prop $envBlock 'HTTP_PROXY'  $proxyUrl
Set-Prop $envBlock 'NO_PROXY'    $proxyBypass

$json      = $settings | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)

# Set the matching persistent user env vars. These are what the Node-based Claude
# CLI reads (inherited by every new terminal). We intentionally leave the WinINET
# registry alone, so Edge/Chrome are unaffected.
[Environment]::SetEnvironmentVariable('HTTPS_PROXY', $proxyUrl,    'User')
[Environment]::SetEnvironmentVariable('HTTP_PROXY',  $proxyUrl,    'User')
[Environment]::SetEnvironmentVariable('NO_PROXY',    $proxyBypass, 'User')

Write-Host ""
Write-Host "  Claude proxy enabled (settings.json + user env vars)" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  settings.json:   $settingsPath"
Write-Host "  env.HTTPS_PROXY: $proxyUrl"
Write-Host "  env.HTTP_PROXY:  $proxyUrl"
Write-Host "  env.NO_PROXY:    $proxyBypass"
Write-Host "  User env vars:   HTTPS_PROXY, HTTP_PROXY, NO_PROXY (persistent)"
Write-Host "  WinINET registry: left untouched (by design)"
Write-Host ""
Write-Host "  Open a NEW terminal and run 'claude' to pick up the proxy." -ForegroundColor Cyan
Write-Host "  Make sure mitmproxy is running before using anything." -ForegroundColor Yellow
Write-Host "  To disable: double-click uninstall-claude-settings.bat" -ForegroundColor DarkGray
Write-Host ""
