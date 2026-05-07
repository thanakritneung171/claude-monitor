#Requires -Version 5
# Start Claude Monitor proxy via Docker Compose.
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Please install Docker Desktop first."
}

# Check .env exists
if (-not (Test-Path "$root\.env")) {
    Write-Host "  .env not found. Copying from .env.example..." -ForegroundColor Yellow
    Copy-Item "$root\.env.example" "$root\.env"
    Write-Host "  Please edit .env and set WORKER_URL and API_KEY, then re-run." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Claude Monitor (Docker)" -ForegroundColor Magenta
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  Starting container..." -ForegroundColor Cyan

Set-Location $root
docker compose up -d --build

Write-Host ""
docker compose ps
Write-Host ""
Write-Host "  Proxy : http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "  Logs  : docker compose logs -f" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  First time? Run as Administrator:" -ForegroundColor Yellow
Write-Host "    .\docker\install-cert.ps1    (copy + install CA cert)" -ForegroundColor Yellow
Write-Host "    .\proxy\enable-proxy.ps1     (set system proxy)" -ForegroundColor Yellow
Write-Host ""
