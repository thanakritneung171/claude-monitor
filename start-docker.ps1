#!/usr/bin/env pwsh
# Claude Monitor Docker Starter

Write-Host "Starting Claude Monitor Proxy (Docker)" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path .env)) {
    Write-Host "env file not found. Creating from .env.example..." -ForegroundColor Yellow
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
        Write-Host "Created .env - please update with your Cloudflare Worker details" -ForegroundColor Green
    } else {
        Write-Host "ERROR: .env.example not found" -ForegroundColor Red
        exit 1
    }
}

# Create log directory if not exists
if (-not (Test-Path log)) {
    New-Item -ItemType Directory -Path log -ErrorAction SilentlyContinue | Out-Null
}

# Check Docker
Write-Host "Checking Docker..." -ForegroundColor Cyan
try {
    docker version 2>&1 | Out-Null
} catch {
    Write-Host "ERROR: Docker not found. Please install Docker Desktop." -ForegroundColor Red
    exit 1
}

# Build
Write-Host "Building Docker image..." -ForegroundColor Cyan
docker-compose build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}

# Start
Write-Host "Starting mitmproxy container..." -ForegroundColor Cyan
docker-compose up -d
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS: Claude Monitor Proxy is running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Proxy address: http://localhost:8080 (local testing)" -ForegroundColor Cyan
    Write-Host "For remote clients: http://<server-ip>:8080" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "View logs: docker logs -f claude-monitor-proxy" -ForegroundColor Cyan
    Write-Host "Stop: docker-compose down" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next: Read DOCKER_SETUP.md for CA certificate setup" -ForegroundColor Cyan
} else {
    Write-Host "ERROR: Failed to start container" -ForegroundColor Red
    exit 1
}
