#Requires -Version 5
# Start Claude Monitor proxy (mitmproxy + addon.py)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

# ── Check mitmproxy ───────────────────────────────────────────────────────────
if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
    Write-Host "mitmproxy not found. Installing..." -ForegroundColor Yellow
    pip install mitmproxy
}

# ── Check config.py ───────────────────────────────────────────────────────────
$cfg = Join-Path $here "config.py"
if (-not (Test-Path $cfg)) {
    Write-Error "config.py not found. Copy config.example.py → config.py and fill in WORKER_URL and API_KEY."
    exit 1
}

# ── Load port from config.py ──────────────────────────────────────────────────
$port = 8080
$portLine = Select-String -Path $cfg -Pattern "PROXY_PORT\s*=\s*(\d+)"
if ($portLine) { $port = [int]$portLine.Matches[0].Groups[1].Value }

Write-Host ""
Write-Host "  Claude Monitor" -ForegroundColor Magenta
Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Proxy  : http://127.0.0.1:$port"
Write-Host "  Target : https://api.anthropic.com"
Write-Host ""
Write-Host "  Configure your apps to use this proxy:" -ForegroundColor Cyan
Write-Host "    System proxy  : Settings > Network > Proxy > Manual > 127.0.0.1:$port"
Write-Host "    Env variable  : `$env:HTTPS_PROXY = 'http://127.0.0.1:$port'"
Write-Host ""
Write-Host "  First-time cert install (run once):" -ForegroundColor Yellow
Write-Host "    .\install-cert.ps1"
Write-Host ""

# Run mitmproxy
Set-Location $here
mitmdump -s addon.py --listen-port $port
