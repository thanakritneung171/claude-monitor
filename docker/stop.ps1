#Requires -Version 5
# Stop Claude Monitor Docker container.
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "  Stopping Claude Monitor (Docker)..." -ForegroundColor Cyan

Set-Location $root
docker compose down

Write-Host ""
Write-Host "  Container stopped." -ForegroundColor Green
Write-Host "  To remove system proxy: .\proxy\disable-proxy.ps1" -ForegroundColor DarkGray
Write-Host ""
