@echo off
REM Extract mitmproxy CA certificate from Docker container

echo.
echo Extracting CA certificate from Docker container...
echo.

docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem

if errorlevel 1 (
    echo ERROR: Failed to extract certificate
    echo.
    echo Make sure:
    echo - Docker is running
    echo - Container is started: docker ps
    echo - Container name is 'claude-monitor-proxy'
    echo.
    pause
    exit /b 1
)

echo SUCCESS: Certificate extracted to mitmproxy-ca.pem
echo.
echo File info:
dir mitmproxy-ca.pem
echo.
echo Next steps:
echo 1. Copy mitmproxy-ca.pem to a shareable location (network share, cloud drive, etc)
echo 2. On each client machine, run: setup-client.cmd
echo 3. Point proxy to: http://^<server-ip^>:8080
echo.
pause
