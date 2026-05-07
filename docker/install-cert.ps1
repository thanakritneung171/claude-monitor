#Requires -RunAsAdministrator
# Copy mitmproxy CA cert from Docker container and install into Windows Trusted Root.
# Run once after first "docker compose up" (container must be running).
$ErrorActionPreference = "Stop"

$root          = Split-Path $PSScriptRoot -Parent
$containerName = "claude-monitor-proxy"
$certDest      = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"

# ── 1. Check Docker ────────────────────────────────────────────────────────────
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Please install Docker Desktop first."
}

# ── 2. Check container is running ─────────────────────────────────────────────
Write-Host ""
Write-Host "  Checking container '$containerName'..." -ForegroundColor Cyan
$state = docker inspect --format "{{.State.Status}}" $containerName 2>$null
if ($LASTEXITCODE -ne 0 -or $state -ne "running") {
    Write-Host "  Container not running. Starting..." -ForegroundColor Yellow
    Set-Location $root
    docker compose up -d
    Write-Host "  Waiting for mitmproxy to generate cert (10s)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 10
}

# ── 3. Copy cert from container ────────────────────────────────────────────────
Write-Host "  Copying cert from container..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Split-Path $certDest) | Out-Null
docker cp "${containerName}:/root/.mitmproxy/mitmproxy-ca-cert.pem" $certDest

if (-not (Test-Path $certDest)) {
    Write-Error "Failed to copy cert. Check container logs:`n  docker compose logs"
}

Write-Host "  Cert saved to: $certDest" -ForegroundColor Green

# ── 4. Install into Windows Trusted Root ──────────────────────────────────────
Write-Host "  Installing cert into Windows Trusted Root..." -ForegroundColor Cyan
certutil -addstore -f Root $certDest | Out-Null

Write-Host ""
Write-Host "  Done. CA cert installed." -ForegroundColor Green
Write-Host "  Next: run  .\docker\enable-proxy.ps1  to set system proxy." -ForegroundColor Yellow
Write-Host "  Then restart Claude Desktop / VSCode / terminal." -ForegroundColor Yellow
Write-Host ""
