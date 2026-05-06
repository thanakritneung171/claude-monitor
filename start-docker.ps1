#!/usr/bin/env pwsh
# Claude Monitor Docker — Install / Uninstall
# Usage: .\start-docker.ps1 install   OR   .\start-docker.ps1 uninstall

param([string]$Action = "help")

# ── Helpers ────────────────────────────────────────────────────────────────────
function Write-OK   { param([string]$msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Fail { param([string]$msg) Write-Host "  FAIL $msg" -ForegroundColor Red; exit 1 }
function Write-Step { param([string]$msg) Write-Host "  ▸ $msg" -ForegroundColor Cyan }

# ── Check Docker ───────────────────────────────────────────────────────────────
function Test-Docker {
    try {
        docker version *>&1 | Out-Null
        return $true
    } catch {
        return $false
    }
}

# ── Install Docker setup ───────────────────────────────────────────────────────
function Install-Docker {
    Write-Host ""
    Write-Host "  Claude Monitor Docker — Install" -ForegroundColor Cyan
    Write-Host ""

    Write-Step "Checking Docker..."
    if (-not (Test-Docker)) {
        Write-Fail "Docker not found. Install Docker Desktop from https://docker.com/products/docker-desktop"
    }
    Write-OK "Docker available"

    Write-Step "Checking .env file..."
    if (-not (Test-Path .env)) {
        if (Test-Path .env.example) {
            Copy-Item .env.example .env
            Write-Host ""
            Write-Host "  ⚠️  Created .env from template" -ForegroundColor Yellow
            Write-Host "      Edit .env and add your Cloudflare Worker details:" -ForegroundColor Yellow
            Write-Host "        WORKER_URL = 'https://your.workers.dev'" -ForegroundColor Yellow
            Write-Host "        API_KEY    = 'your-secret-key'" -ForegroundColor Yellow
            Write-Host ""
            Read-Host "  Press Enter after updating .env"
        } else {
            Write-Fail ".env.example not found"
        }
    }
    Write-OK ".env configured"

    Write-Step "Creating log directory..."
    if (-not (Test-Path log)) {
        New-Item -ItemType Directory -Path log | Out-Null
    }
    Write-OK "log directory ready"

    Write-Step "Building Docker image..."
    docker-compose build
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Build failed"
    }
    Write-OK "Image built"

    Write-Step "Starting container..."
    docker-compose up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to start container"
    }
    Write-OK "Container running"

    Write-Host ""
    Write-Host "  ✅ Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Proxy address: http://localhost:8080" -ForegroundColor Cyan
    Write-Host "  View logs: docker logs -f claude-monitor-proxy" -ForegroundColor Gray
    Write-Host "  Stop: docker-compose down" -ForegroundColor Gray
    Write-Host ""
}

# ── Uninstall Docker setup ─────────────────────────────────────────────────────
function Uninstall-Docker {
    Write-Host ""
    Write-Host "  Claude Monitor Docker — Uninstall" -ForegroundColor Cyan
    Write-Host ""

    Write-Step "Stopping container..."
    docker-compose down -v 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Container stopped"
    } else {
        Write-OK "No container running"
    }

    Write-Host ""
    Write-Host "  ✅ Uninstall complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  To remove Docker images: docker rmi claude-monitor-proxy" -ForegroundColor Gray
    Write-Host ""
}

# ── Main ───────────────────────────────────────────────────────────────────────
switch ($Action.ToLower()) {
    "install"   { Install-Docker }
    "uninstall" { Uninstall-Docker }
    default {
        Write-Host ""
        Write-Host "  Claude Monitor Docker" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Usage:" -ForegroundColor Yellow
        Write-Host "    .\start-docker.ps1 install        Install Docker setup" -ForegroundColor Gray
        Write-Host "    .\start-docker.ps1 uninstall      Stop and remove containers" -ForegroundColor Gray
        Write-Host ""
    }
}
