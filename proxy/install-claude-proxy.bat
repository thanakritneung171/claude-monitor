@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
$proxyUrl     = "http://10.10.84.1:8081"
$caCert       = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

if (-not (Test-Path $caCert)) {
    Write-Host "CA cert not found. Generating via mitmdump..." -ForegroundColor Yellow

    if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
        Write-Host "  mitmdump not found - trying pip install mitmproxy..." -ForegroundColor Yellow
        if (-not (Get-Command pip -ErrorAction SilentlyContinue)) {
            Write-Error "pip not found. Install Python from https://python.org first, then re-run."
            return
        }
        pip install mitmproxy
        if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
            Write-Error "Failed to install mitmproxy. Run 'pip install mitmproxy' manually, then re-run."
            return
        }
    }

    # Start mitmdump briefly on a throwaway port so it bootstraps the CA cert,
    # then kill it. The cert is written to ~/.mitmproxy/ on first launch.
    $tmpProc = Start-Process -FilePath "mitmdump" -ArgumentList "--listen-port","18080","-q" -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $caCert) { break }
    }
    try { Stop-Process -Id $tmpProc.Id -Force -ErrorAction SilentlyContinue } catch {}

    if (-not (Test-Path $caCert)) {
        Write-Error "Failed to generate CA cert. Try running 'mitmdump' manually once, then re-run."
        return
    }
    Write-Host "  CA cert generated at: $caCert" -ForegroundColor Green
}

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

Set-Prop $envBlock 'HTTPS_PROXY'         $proxyUrl
Set-Prop $envBlock 'HTTP_PROXY'          $proxyUrl
Set-Prop $envBlock 'NODE_EXTRA_CA_CERTS' $caCert

$json      = $settings | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)

[Environment]::SetEnvironmentVariable('HTTPS_PROXY',         $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('HTTP_PROXY',          $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', $caCert,   'User')
[Environment]::SetEnvironmentVariable('REQUESTS_CA_BUNDLE',  $caCert,   'User')
[Environment]::SetEnvironmentVariable('SSL_CERT_FILE',       $caCert,   'User')

Write-Host ""
Write-Host "  Claude proxy config installed" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  Claude Code settings.json: $settingsPath"
Write-Host "  Persistent user env vars:  HTTPS_PROXY, HTTP_PROXY, NODE_EXTRA_CA_CERTS,"
Write-Host "                             REQUESTS_CA_BUNDLE, SSL_CERT_FILE"
Write-Host "  Proxy URL:                 $proxyUrl"
Write-Host "  CA cert:                   $caCert"
Write-Host ""
Write-Host "  IMPORTANT: Fully QUIT Claude Desktop (system tray -> Quit) and reopen" -ForegroundColor Yellow
Write-Host "             so Cowork's worker process inherits the new env vars." -ForegroundColor Yellow
Write-Host "  Open a new terminal and run 'claude' - Claude Code will pick up the proxy." -ForegroundColor Cyan
Write-Host "  Make sure mitmproxy is running (proxy\start.ps1) before using anything." -ForegroundColor Yellow
Write-Host ""
