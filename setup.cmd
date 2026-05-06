@echo off
REM Claude Monitor Docker Setup

echo.
echo Starting Claude Monitor Proxy (Docker)
echo.

REM Check if .env exists
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo.
    echo IMPORTANT: Edit .env with your Cloudflare Worker details:
    echo   - WORKER_URL
    echo   - API_KEY
    echo.
    pause
)

REM Create log directory
if not exist log mkdir log

REM Check Docker
echo.
echo Checking Docker...
docker ps >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running
    echo.
    echo Please:
    echo 1. Install Docker Desktop from https://www.docker.com/products/docker-desktop
    echo 2. Start Docker Desktop
    echo.
    pause
    exit /b 1
)

echo Docker is OK
echo.

REM Build
echo Building Docker image...
docker-compose build
if errorlevel 1 (
    echo Build failed
    pause
    exit /b 1
)

REM Start
echo.
echo Starting mitmproxy container...
docker-compose up -d
if errorlevel 1 (
    echo Failed to start container
    pause
    exit /b 1
)

echo.
echo SUCCESS: Claude Monitor Proxy is running!
echo.
echo Proxy address (local):  http://localhost:8080
echo Proxy address (remote): http://<server-ip>:8080
echo.
echo View logs: docker logs -f claude-monitor-proxy
echo Stop:      docker-compose down
echo.
echo Next step: Read DOCKER_SETUP.md for client certificate setup
echo.
pause
