#Requires -Version 5
# Claude Monitor — Complete Installer
# Usage: Right-click → "Run with PowerShell"  OR  .\install.ps1

$ErrorActionPreference = "Continue"
$here = $PSScriptRoot

# ── Helpers ────────────────────────────────────────────────────────────────────
function Write-Step { param([int]$n, [string]$msg) Write-Host ("  [{0}/7] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Write-OK   { param([string]$msg) Write-Host "         OK  $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "        WARN $msg" -ForegroundColor Yellow }
function Write-Fail {
    param([string]$msg)
    Write-Host "        FAIL $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "  Press Enter to close"
    exit 1
}

function Set-JsonProp {
    param($Obj, [string]$Name, $Val)
    if ($Obj.PSObject.Properties.Name -contains $Name) { $Obj.$Name = $Val }
    else { $Obj | Add-Member -MemberType NoteProperty -Name $Name -Value $Val }
}

# ── Banner ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║       Claude Monitor  Installer      ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ── Step 1: Python ─────────────────────────────────────────────────────────────
Write-Step 1 "Checking Python"
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Fail "Python not found. Install Python 3.9+ from https://python.org then re-run."
}
$pyVer = (python --version 2>&1).ToString().Trim()
Write-OK $pyVer

# ── Step 2: mitmproxy ──────────────────────────────────────────────────────────
Write-Step 2 "Installing mitmproxy"
if (Get-Command mitmdump -ErrorAction SilentlyContinue) {
    $mitmVer = (mitmdump --version 2>&1 | Select-Object -First 1).ToString().Trim()
    Write-OK "Already installed: $mitmVer"
} else {
    Write-Host "         Running pip install mitmproxy..." -ForegroundColor DarkGray
    pip install mitmproxy
    if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
        Write-Fail "mitmproxy not found after install. Try running: pip install mitmproxy"
    }
    $mitmVer = (mitmdump --version 2>&1 | Select-Object -First 1).ToString().Trim()
    Write-OK "Installed: $mitmVer"
}

# ── Step 3: config.py ──────────────────────────────────────────────────────────
Write-Step 3 "Checking proxy\config.py"
$cfgPath    = Join-Path $here "proxy\config.py"
$cfgExample = Join-Path $here "proxy\config.example.py"

if (-not (Test-Path $cfgPath)) {
    if (Test-Path $cfgExample) {
        Copy-Item $cfgExample $cfgPath
        Write-Host ""
        Write-Host "  ┌─────────────────────────────────────────┐" -ForegroundColor Yellow
        Write-Host "  │  config.py created from template         │" -ForegroundColor Yellow
        Write-Host "  │                                          │" -ForegroundColor Yellow
        Write-Host "  │  Edit  proxy\config.py  and fill in:     │" -ForegroundColor Yellow
        Write-Host "  │    WORKER_URL = 'https://your.workers.dev'│" -ForegroundColor Yellow
        Write-Host "  │    API_KEY    = 'your-secret-key'         │" -ForegroundColor Yellow
        Write-Host "  │                                          │" -ForegroundColor Yellow
        Write-Host "  │  Then re-run install.ps1                 │" -ForegroundColor Yellow
        Write-Host "  └─────────────────────────────────────────┘" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "  Press Enter to close"
        exit 0
    }
    Write-Fail "proxy\config.py not found and no config.example.py to copy from."
}
Write-OK "proxy\config.py found"

# ── Step 4: Generate CA cert ───────────────────────────────────────────────────
Write-Step 4 "Generating mitmproxy CA certificate"
$certPath = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"

if (Test-Path $certPath) {
    Write-OK "Already exists: $certPath"
} else {
    Write-Host "         Starting mitmproxy briefly to generate cert..." -ForegroundColor DarkGray
    $tempProc = Start-Process mitmdump -ArgumentList "--listen-port 19099 -q" -PassThru -WindowStyle Hidden -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
    if ($tempProc -and -not $tempProc.HasExited) {
        Stop-Process -Id $tempProc.Id -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $certPath)) {
        Write-Fail "CA cert not generated at $certPath. Run mitmdump manually once, then re-run install.ps1."
    }
    Write-OK "Generated: $certPath"
}

# ── Step 5: Install CA cert into Trusted Root (UAC) ───────────────────────────
Write-Step 5 "Installing CA cert to Windows Trusted Root"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

# Temp script to run elevated
$tempPs1 = [System.IO.Path]::GetTempPath() + "mitm-cert-install-$PID.ps1"
$certInstallScript = @"
`$certPath = '$($certPath.Replace("'", "''"))'
Write-Host ""
Write-Host "  Installing mitmproxy CA cert..." -ForegroundColor Cyan
certutil -addstore -f Root "`$certPath"
if (`$LASTEXITCODE -eq 0) {
    Write-Host "  Done! CA cert installed." -ForegroundColor Green
} else {
    Write-Host "  certutil returned `$LASTEXITCODE — cert may already be installed." -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
"@

if ($isAdmin) {
    certutil -addstore -f Root $certPath | Out-Null
    Write-OK "Installed to Trusted Root"
} else {
    Write-Host "         A UAC prompt will appear — click Yes to allow cert installation." -ForegroundColor Yellow
    Set-Content -Path $tempPs1 -Value $certInstallScript -Encoding UTF8
    $proc = Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempPs1`"" -Verb RunAs -Wait -PassThru -ErrorAction SilentlyContinue
    Remove-Item $tempPs1 -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ExitCode -ne 0) {
        Write-Warn "UAC was denied or certutil failed. Run proxy\install-cert.ps1 as Administrator manually."
        Write-Warn "SSL errors will occur until the cert is installed."
    } else {
        Write-OK "Installed to Trusted Root"
    }
}

# ── Step 6: Configure ~/.claude/settings.json ─────────────────────────────────
Write-Step 6 "Configuring Claude Code settings.json"
$proxyUrl     = "http://127.0.0.1:8080"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$claudeDir    = Split-Path $settingsPath -Parent

if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $settings = [PSCustomObject]@{}
    } else {
        try { $settings = $raw | ConvertFrom-Json }
        catch { Write-Fail "Could not parse settings.json as JSON. Fix it manually then re-run." }
    }
} else {
    $settings = [PSCustomObject]@{}
}

if (-not ($settings.PSObject.Properties.Name -contains 'env')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'env' -Value ([PSCustomObject]@{})
}
$envBlock = $settings.env
Set-JsonProp $envBlock 'HTTPS_PROXY'         $proxyUrl
Set-JsonProp $envBlock 'HTTP_PROXY'          $proxyUrl
Set-JsonProp $envBlock 'NODE_EXTRA_CA_CERTS' $certPath

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 20), $utf8NoBom)
Write-OK "Updated: $settingsPath"

# ── Step 7: Persistent user environment variables ─────────────────────────────
Write-Step 7 "Setting persistent user environment variables"
[Environment]::SetEnvironmentVariable('HTTPS_PROXY',         $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('HTTP_PROXY',          $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', $certPath, 'User')
[Environment]::SetEnvironmentVariable('REQUESTS_CA_BUNDLE',  $certPath, 'User')
[Environment]::SetEnvironmentVariable('SSL_CERT_FILE',       $certPath, 'User')
Write-OK "HTTPS_PROXY, HTTP_PROXY, NODE_EXTRA_CA_CERTS, REQUESTS_CA_BUNDLE, SSL_CERT_FILE"

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║      Installation complete!          ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  What to do now:" -ForegroundColor White
Write-Host "   1. Quit Claude Desktop fully (system tray → Quit) then reopen" -ForegroundColor Yellow
Write-Host "   2. Start the monitor:  proxy\start.ps1" -ForegroundColor Cyan
Write-Host "   3. Use Claude — all API calls will appear in the dashboard" -ForegroundColor White
Write-Host ""
Write-Host "  To uninstall:  .\uninstall.ps1" -ForegroundColor DarkGray
Write-Host ""

# ── Ask to start proxy ─────────────────────────────────────────────────────────
$ans = Read-Host "  Start the monitor proxy now? [Y/n]"
if ($ans -ne 'n' -and $ans -ne 'N') {
    Write-Host ""
    Write-Host "  Starting Claude Monitor proxy in a new window..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$here\proxy\start.ps1`""
    Write-Host "  Proxy started. Keep that window open while using Claude." -ForegroundColor Green
}

Write-Host ""
Read-Host "  Press Enter to close this window"
