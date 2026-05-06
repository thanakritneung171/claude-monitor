@echo off
REM Claude Monitor - Quick Setup
REM This sets up HTTP proxy and imports certificate

setlocal enabledelayedexpansion

cls
echo ============================================
echo Claude Monitor - Quick Setup
echo ============================================
echo.

REM Create temporary registry file for proxy settings
echo Creating proxy settings...

(
echo Windows Registry Editor Version 5.00
echo.
echo [HKEY_CURRENT_USER\Environment]
echo "HTTP_PROXY"="http://127.0.0.1:8080"
echo "HTTPS_PROXY"="http://127.0.0.1:8080"
echo "ALL_PROXY"="http://127.0.0.1:8080"
) > "%TEMP%\setup-proxy.reg"

REM Import registry
echo Importing proxy settings to registry...
reg import "%TEMP%\setup-proxy.reg" >nul 2>&1

if errorlevel 1 (
    echo ERROR: Failed to import registry
    echo Please run as Administrator
    pause
    exit /b 1
)

echo [OK] Proxy environment variables set
echo.

REM Check for certificate file
if not exist "mitmproxy-ca.pem" (
    echo ERROR: mitmproxy-ca.pem not found
    echo.
    echo Expected location: %cd%\mitmproxy-ca.pem
    pause
    exit /b 1
)

echo [OK] Certificate file found: mitmproxy-ca.pem
echo.

REM Try to import certificate
echo Installing certificate to Trusted Root...
echo.

REM Method 1: certutil
certutil -addstore Root "mitmproxy-ca.pem" >nul 2>&1
if errorlevel 1 (
    echo.
    echo NOTE: Automatic import failed
    echo Please follow these steps:
    echo.
    echo 1. Right-click mitmproxy-ca.pem
    echo 2. Select "Install Certificate"
    echo 3. Choose: Current User
    echo 4. Choose: Trusted Root Certification Authorities
    echo 5. Click: Next, Finish, OK
    echo.
    pause
) else (
    echo [OK] Certificate installed successfully
    echo.
)

echo ============================================
echo SETUP COMPLETE!
echo ============================================
echo.
echo Proxy Settings:
echo   HTTP_PROXY=http://127.0.0.1:8080
echo   HTTPS_PROXY=http://127.0.0.1:8080
echo   ALL_PROXY=http://127.0.0.1:8080
echo.
echo Certificate: Trusted Root Certification Authorities
echo.
echo NEXT STEPS:
echo -----------
echo 1. Close Claude Desktop (if running)
echo 2. Close Claude Code / VSCode (if running)
echo 3. Restart them
echo 4. Test with: curl -v https://api.anthropic.com
echo.
echo SERVER INFO:
echo   docker logs -f claude-monitor-proxy
echo.
pause
