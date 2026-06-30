@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
# Uninstaller: removes the PAC + the autostart entry, kills the PAC server, and
# clears WinINET autoconfig so ALL traffic goes DIRECT again. Pairs with
# install-claude-pac.bat.
$pac     = Join-Path $env:USERPROFILE ".claude\claude-proxy.pac"
$reg     = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$run     = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "ClaudeMonitorPacServer"
$removed = @()

# Remove the autostart entry (HKCU Run).
$rp = Get-ItemProperty -Path $run -ErrorAction SilentlyContinue
if ($rp -and ($rp.PSObject.Properties.Name -contains $runName)) {
    Remove-ItemProperty -Path $run -Name $runName -ErrorAction SilentlyContinue
    $removed += "autostart (HKCU Run)"
}

# Kill any running PAC server process.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*pac-server.ps1*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $removed += "pac-server (pid $($_.ProcessId))" } catch {} }

# Clear WinINET autoconfig + manual proxy.
$props = Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
if ($props -and ($props.PSObject.Properties.Name -contains 'AutoConfigURL')) {
    Remove-ItemProperty -Path $reg -Name AutoConfigURL -ErrorAction SilentlyContinue
    $removed += "AutoConfigURL"
}
Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0

# Reload WinINET.
$sig = '[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'
$wi = Add-Type -MemberDefinition $sig -Name WinInetApi -Namespace ClaudePac -PassThru
$wi::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
$wi::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null

# Delete the PAC file.
if (Test-Path $pac) { Remove-Item $pac -Force -ErrorAction SilentlyContinue; $removed += "claude-proxy.pac" }

Write-Host ""
Write-Host "  Claude PAC removed" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
if ($removed.Count -gt 0) { Write-Host ("  Removed: " + ($removed -join ', ')) } else { Write-Host "  Nothing to remove." }
Write-Host "  All traffic now connects DIRECT (no proxy)." -ForegroundColor Cyan
Write-Host "  Reopen DingTalk / browser / Claude Desktop to pick up the change." -ForegroundColor Yellow
