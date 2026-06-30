@echo off
setlocal
set "PAC_BAT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
# Installer: sets up the Claude-only PAC + a tiny localhost http server that serves
# it, and points WinINET at http://127.0.0.1:<port>/proxy.pac. Result: ONLY
# Claude/Anthropic domains go through the monitoring proxy (every client, incl.
# Chromium-based Claude Desktop and browsers); everything else (DingTalk, etc.)
# connects DIRECT, with or without VPN. Pairs with uninstall-claude-pac.bat.
# http:// is required because Chromium / WinHTTP reject file:// PAC urls.
$port    = 8099
$pacDir  = Join-Path $env:USERPROFILE ".claude"
$pac     = Join-Path $pacDir "claude-proxy.pac"
$server  = Join-Path $env:PAC_BAT_DIR "pac-server.ps1"
$reg     = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$run     = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "ClaudeMonitorPacServer"
$launch  = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$server`" -Port $port"

if (-not (Test-Path $pacDir)) { New-Item -ItemType Directory -Path $pacDir -Force | Out-Null }
if (-not (Test-Path $server)) { Write-Error "pac-server.ps1 not found next to this .bat ($server)."; return }

# 1) Write the PAC. Host list mirrors mitmproxy --allow-hosts in start.ps1.
$pacContent = @'
function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.anthropic.com") || shExpMatch(host, "anthropic.com") ||
      shExpMatch(host, "*.claude.ai")     || shExpMatch(host, "claude.ai")     ||
      shExpMatch(host, "*.claudeusercontent.com")) {
    return "PROXY 10.10.84.1:8081";
  }
  return "DIRECT";
}
'@
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($pac, $pacContent, $utf8NoBom)

# 2) (Re)start the PAC server now and register it to auto-start at logon via the
#    HKCU Run key (no admin needed; scheduled tasks require elevation here).
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*pac-server.ps1*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
Start-Process powershell -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$server`" -Port $port" -WindowStyle Hidden
Set-ItemProperty -Path $run -Name $runName -Value $launch
Start-Sleep -Seconds 2

# 3) Point WinINET at the http PAC; turn the manual catch-all proxy off.
$pacUrl = "http://127.0.0.1:$port/proxy.pac"
Set-ItemProperty -Path $reg -Name AutoConfigURL -Value $pacUrl
Set-ItemProperty -Path $reg -Name ProxyEnable   -Value 0

# 4) Reload WinINET immediately.
$sig = '[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'
$wi = Add-Type -MemberDefinition $sig -Name WinInetApi -Namespace ClaudePac -PassThru
$wi::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
$wi::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null

# 5) Self-check: is the PAC actually being served?
$served = try { (Invoke-WebRequest -Uri $pacUrl -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "DOWN - $($_.Exception.Message)" }

Write-Host ""
Write-Host "  Claude PAC installed (http server mode)" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  PAC file:      $pac"
Write-Host "  PAC server:    $pacUrl   (HTTP status: $served)"
Write-Host "  Autostart:     HKCU Run -> $runName"
Write-Host "  ProxyEnable:   0"
Write-Host ""
Write-Host "  Claude/Anthropic -> proxy 10.10.84.1:8081 (needs VPN, monitored)" -ForegroundColor Cyan
Write-Host "  Everything else (DingTalk, browsers) -> DIRECT (works without VPN)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Tip: fully close and reopen DingTalk / browser / Claude Desktop to re-read." -ForegroundColor Yellow
Write-Host "  To revert: double-click uninstall-claude-pac.bat" -ForegroundColor DarkGray
