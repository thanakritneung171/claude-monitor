@echo off
REM Claude Monitor - Automatic Setup (Batch wrapper)
REM This script will run PowerShell with admin privileges

setlocal enabledelayedexpansion

REM Check if running as admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo This script requires Administrator privileges.
    echo Restarting as Administrator...
    echo.

    REM Get the directory where this script is located
    set "scriptdir=%~dp0"
    set "scriptname=%~n0"

    REM Re-run as admin using PowerShell
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0setup-auto.ps1\"' -Verb RunAs"
    exit /b
)

REM Run the PowerShell setup script
echo Running Claude Monitor Setup...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-auto.ps1" "127.0.0.1:8080"

if errorlevel 1 (
    echo.
    echo Setup failed. Please run manually:
    echo   .\setup-auto.ps1
    pause
    exit /b 1
)

echo.
echo Setup completed successfully!
echo.
pause
