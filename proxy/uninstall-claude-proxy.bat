@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
# SDB AI Insight - client uninstaller. Undoes install-claude-proxy.bat (current PAC
# version and the older catch-all / user-env versions). Only removes values that are
# still OURS and puts back what the installer saved under HKCU\Software\SDBAIInsight,
# so a proxy / PAC / env var set by the user or IT is left alone.

$proxyUrl      = "http://10.10.84.1:8081"
$proxyHost     = "10.10.84.1:8081"
$pacUrl        = "https://claude-monitor-hooks.cloudflare-training3.workers.dev/proxy.pac"
$claudeDir     = Join-Path $env:USERPROFILE ".claude"
$settingsPath  = Join-Path $claudeDir "settings.json"
$caPath        = Join-Path $claudeDir "sdb-ai-insight-ca.pem"
$oldCaPath     = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"
$legacyPacUrl  = "http://127.0.0.1:8099/proxy.pac"
$legacyPacFile = Join-Path $claudeDir "claude-proxy.pac"
$backupKey     = "HKCU:\Software\SDBAIInsight"
$inetKey       = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
# NO_PROXY entries the installers ever wrote into settings.json
$ourNoProxy    = @('localhost', '127.0.0.1', '103.87.217.15', '10.16.0.0/16', '.dev.softdebut.com',
                   'github.com', '.github.com', '.githubusercontent.com', 'registry.npmjs.org',
                   'pypi.org', 'files.pythonhosted.org')
# user-env NO_PROXY values written by older SDB AI Insight scripts
$knownUserNoProxy = @('localhost,127.0.0.1,103.87.217.15,10.16.0.0/16,.dev.softdebut.com',
                      'localhost,127.0.0.1,::1,.local')
# WinINET bypass list written by the old catch-all installer
$oldBypassWin  = "localhost;127.0.0.1;103.87.217.15;10.16.*;*.dev.softdebut.com;<local>"

Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace SdbAi {
  public static class InetProxy {
    [StructLayout(LayoutKind.Explicit)]
    struct OptVal { [FieldOffset(0)] public int dw; [FieldOffset(0)] public IntPtr psz; [FieldOffset(0)] public int ftLow; [FieldOffset(4)] public int ftHigh; }
    [StructLayout(LayoutKind.Sequential)]
    struct Opt { public int dwOption; public OptVal Value; }
    [StructLayout(LayoutKind.Sequential)]
    struct OptList { public int dwSize; public IntPtr pszConnection; public int dwOptionCount; public int dwOptionError; public IntPtr pOptions; }
    [DllImport("wininet.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool InternetSetOptionW(IntPtr h, int opt, IntPtr buf, int len);
    [DllImport("wininet.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool InternetQueryOptionW(IntPtr h, int opt, IntPtr buf, ref int len);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr p);
    const int PER_CONN = 75;
    static readonly int[] Ids = { 1, 2, 3, 4 }; // FLAGS, PROXY_SERVER, PROXY_BYPASS, AUTOCONFIG_URL
    public const int DIRECT = 1, PROXY = 2, AUTO_PROXY_URL = 4, AUTO_DETECT = 8;

    public static void Refresh() {
      InternetSetOptionW(IntPtr.Zero, 39, IntPtr.Zero, 0); // INTERNET_OPTION_SETTINGS_CHANGED
      InternetSetOptionW(IntPtr.Zero, 37, IntPtr.Zero, 0); // INTERNET_OPTION_REFRESH
    }

    // PowerShell passes $null to a string parameter as "", so treat "" as LAN too.
    static IntPtr ConnPtr(string conn) { return string.IsNullOrEmpty(conn) ? IntPtr.Zero : Marshal.StringToHGlobalUni(conn); }

    public static object[] Query(string conn) {
      int optSize = Marshal.SizeOf(typeof(Opt));
      IntPtr opts = Marshal.AllocCoTaskMem(optSize * Ids.Length);
      IntPtr pConn = ConnPtr(conn);
      OptList list = new OptList();
      list.dwSize = Marshal.SizeOf(typeof(OptList)); list.pszConnection = pConn;
      list.dwOptionCount = Ids.Length; list.pOptions = opts;
      IntPtr pList = Marshal.AllocCoTaskMem(list.dwSize);
      try {
        for (int i = 0; i < Ids.Length; i++) {
          Opt o = new Opt(); o.dwOption = Ids[i];
          Marshal.StructureToPtr(o, new IntPtr(opts.ToInt64() + i * optSize), false);
        }
        Marshal.StructureToPtr(list, pList, false);
        int len = list.dwSize;
        if (!InternetQueryOptionW(IntPtr.Zero, PER_CONN, pList, ref len))
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        object[] r = new object[Ids.Length];
        for (int i = 0; i < Ids.Length; i++) {
          Opt o = (Opt)Marshal.PtrToStructure(new IntPtr(opts.ToInt64() + i * optSize), typeof(Opt));
          if (i == 0) { r[i] = o.Value.dw; }
          else {
            r[i] = o.Value.psz == IntPtr.Zero ? "" : Marshal.PtrToStringUni(o.Value.psz);
            if (o.Value.psz != IntPtr.Zero) GlobalFree(o.Value.psz);
          }
        }
        return r;
      } finally {
        Marshal.FreeCoTaskMem(opts); Marshal.FreeCoTaskMem(pList);
        if (pConn != IntPtr.Zero) Marshal.FreeHGlobal(pConn);
      }
    }

    public static void Set(string conn, int flags, string proxyServer, string proxyBypass, string autoConfigUrl) {
      string[] s = { null, proxyServer ?? "", proxyBypass ?? "", autoConfigUrl ?? "" };
      int optSize = Marshal.SizeOf(typeof(Opt));
      IntPtr opts = Marshal.AllocCoTaskMem(optSize * Ids.Length);
      IntPtr[] strs = new IntPtr[Ids.Length];
      IntPtr pConn = ConnPtr(conn);
      OptList list = new OptList();
      list.dwSize = Marshal.SizeOf(typeof(OptList)); list.pszConnection = pConn;
      list.dwOptionCount = Ids.Length; list.pOptions = opts;
      IntPtr pList = Marshal.AllocCoTaskMem(list.dwSize);
      try {
        for (int i = 0; i < Ids.Length; i++) {
          Opt o = new Opt(); o.dwOption = Ids[i];
          if (i == 0) o.Value.dw = flags;
          else { strs[i] = Marshal.StringToHGlobalUni(s[i]); o.Value.psz = strs[i]; }
          Marshal.StructureToPtr(o, new IntPtr(opts.ToInt64() + i * optSize), false);
        }
        Marshal.StructureToPtr(list, pList, false);
        if (!InternetSetOptionW(IntPtr.Zero, PER_CONN, pList, list.dwSize))
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        Refresh();
      } finally {
        foreach (IntPtr p in strs) if (p != IntPtr.Zero) Marshal.FreeHGlobal(p);
        Marshal.FreeCoTaskMem(opts); Marshal.FreeCoTaskMem(pList);
        if (pConn != IntPtr.Zero) Marshal.FreeHGlobal(pConn);
      }
    }
  }
}
'@

function Test-OurProxyServer([string]$server) {
    foreach ($part in ($server -split ';')) {
        if ((($part -replace '^[A-Za-z]+=', '').Trim()) -eq $proxyHost) { return $true }
    }
    return $false
}

function Test-OurProxyUrl([string]$v) { return ([string]$v).Trim().TrimEnd('/') -eq $proxyUrl }

function Remove-OurUserEnv([string]$Name, [string[]]$OurValues) {
    $props = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
    if (-not $props -or -not ($props.PSObject.Properties.Name -contains $Name)) { return $false }
    $v = ([string]$props.$Name).Trim().TrimEnd('/')
    foreach ($o in $OurValues) {
        if ($v -eq $o.Trim().TrimEnd('/')) {
            [Environment]::SetEnvironmentVariable($Name, $null, 'User')
            return $true
        }
    }
    return $false
}

function Set-Prop {
    param($Object, [string]$Name, $Value)
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

$backup = Get-ItemProperty -Path $backupKey -ErrorAction SilentlyContinue
function Get-Backup([string]$Name) {
    if ($backup -and ($backup.PSObject.Properties.Name -contains $Name)) { return $backup.$Name }
    return $null
}

# --- 1) ~/.claude/settings.json env keys (only our values; put back saved ones)
$changedKeys = @()
$settingsMsg = "no settings.json"
if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw -Encoding UTF8
    $settings = $null
    $settingsMsg = "no proxy keys of ours"
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        try { $settings = $raw | ConvertFrom-Json } catch {
            $settingsMsg = "NOT changed - not valid JSON (fix it by hand)"
        }
    }
    if ($settings -and ($settings.PSObject.Properties.Name -contains 'env')) {
        $envBlock = $settings.env
        $names    = @($envBlock.PSObject.Properties.Name)
        foreach ($key in 'HTTPS_PROXY', 'HTTP_PROXY') {
            if (($names -contains $key) -and (Test-OurProxyUrl $envBlock.$key)) {
                $prev = Get-Backup "PrevEnv_$key"
                if ($prev) { $envBlock.$key = $prev; $changedKeys += "$key (restored)" }
                else { $envBlock.PSObject.Properties.Remove($key); $changedKeys += $key }
            }
        }
        if ($names -contains 'NO_PROXY') {
            $prev = Get-Backup 'PrevEnv_NO_PROXY'
            $left = @(([string]$envBlock.NO_PROXY) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and ($ourNoProxy -notcontains $_) })
            if ($prev) {
                $envBlock.NO_PROXY = $prev; $changedKeys += 'NO_PROXY (restored)'
            } elseif ($left.Count -gt 0) {
                if ($left.Count -ne @(([string]$envBlock.NO_PROXY) -split ',' | Where-Object { $_.Trim() }).Count) {
                    $envBlock.NO_PROXY = ($left -join ','); $changedKeys += 'NO_PROXY (our entries)'
                }
            } else {
                $envBlock.PSObject.Properties.Remove('NO_PROXY'); $changedKeys += 'NO_PROXY'
            }
        }
        if (($names -contains 'NODE_EXTRA_CA_CERTS') -and (@($caPath, $oldCaPath) -contains [string]$envBlock.NODE_EXTRA_CA_CERTS)) {
            $envBlock.PSObject.Properties.Remove('NODE_EXTRA_CA_CERTS'); $changedKeys += 'NODE_EXTRA_CA_CERTS'
        }
        if (@($envBlock.PSObject.Properties).Count -eq 0) { $settings.PSObject.Properties.Remove('env') }
        if ($changedKeys.Count -gt 0) {
            $json      = $settings | ConvertTo-Json -Depth 20
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)
            $settingsMsg = $changedKeys -join ', '
        }
    }
}

# --- 2) User-level env vars set by older installers (only our values)
$clearedEnv = @()
foreach ($k in 'HTTPS_PROXY', 'HTTP_PROXY') {
    if (Remove-OurUserEnv $k @($proxyUrl)) { $clearedEnv += $k }
}
if (Remove-OurUserEnv 'ALL_PROXY' @($proxyUrl, '')) { $clearedEnv += 'ALL_PROXY' }
$userProxyLeft = [Environment]::GetEnvironmentVariable('HTTPS_PROXY', 'User') -or
                 [Environment]::GetEnvironmentVariable('HTTP_PROXY',  'User') -or
                 [Environment]::GetEnvironmentVariable('ALL_PROXY',   'User')
if (-not $userProxyLeft) {
    $userNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'User')
    $noProxyOurs = $knownUserNoProxy
    if ($userNoProxy -and ($clearedEnv -contains 'HTTPS_PROXY' -or $clearedEnv -contains 'HTTP_PROXY')) {
        $noProxyOurs = $knownUserNoProxy + @($userNoProxy)
    }
    if (Remove-OurUserEnv 'NO_PROXY' $noProxyOurs) { $clearedEnv += 'NO_PROXY' }
}
foreach ($k in 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE') {
    if (Remove-OurUserEnv $k @($oldCaPath, $caPath)) { $clearedEnv += $k }
}

# --- 3) Windows system proxy: remove our PAC / old catch-all, put back saved settings
$inetMsg = @()
$inetCur = $null
try { $inetCur = [SdbAi.InetProxy]::Query($null) } catch {
    Write-Host "  ERROR: cannot read the Windows proxy settings ($_) - system proxy NOT changed." -ForegroundColor Red
}
if ($inetCur) {
    $curFlags  = [int]$inetCur[0]; $curServer = [string]$inetCur[1]; $curBypass = [string]$inetCur[2]; $curPac = [string]$inetCur[3]
    $newFlags  = $curFlags -bor [SdbAi.InetProxy]::DIRECT
    $newServer = $curServer; $newBypass = $curBypass; $newPac = $curPac
    if ($curPac -eq $pacUrl -or $curPac -eq $legacyPacUrl) {
        $newFlags = $newFlags -band (-bnot [SdbAi.InetProxy]::AUTO_PROXY_URL)
        $prevPac  = Get-Backup 'PrevAutoConfigURL'
        if ($prevPac) {
            $newPac = $prevPac            # it was saved but switched off - restore it switched off
            $inetMsg += "PAC removed (your previous setup script address '$prevPac' restored, off)"
        } else {
            $newPac = ''
            $inetMsg += "PAC removed"
        }
        if ((Get-Backup 'PrevAutoDetect') -eq 1) {
            $newFlags = $newFlags -bor [SdbAi.InetProxy]::AUTO_DETECT
            $inetMsg += "'Automatically detect settings' turned back on"
        }
    }
    if (Test-OurProxyServer $curServer) {
        $newServer = ''
        $newFlags  = $newFlags -band (-bnot [SdbAi.InetProxy]::PROXY)
        $inetMsg  += "old catch-all proxy $proxyHost turned off"
    }
    if ($curBypass -eq $oldBypassWin) { $newBypass = '' }
    $changed = ($newFlags -ne $curFlags) -or ($newServer -ne $curServer) -or ($newBypass -ne $curBypass) -or ($newPac -ne $curPac)
    if ($changed) {
        try {
            [SdbAi.InetProxy]::Set($null, $newFlags, $newServer, $newBypass, $newPac)
        } catch {
            Write-Host "  WARNING: InternetSetOption failed ($_) - writing registry values only." -ForegroundColor Yellow
        }
        $inet = Get-ItemProperty -Path $inetKey -ErrorAction SilentlyContinue
        $wantEnable = [int](($newFlags -band [SdbAi.InetProxy]::PROXY) -ne 0)
        if ($inet.ProxyEnable -ne $wantEnable) { Set-ItemProperty -Path $inetKey -Name ProxyEnable -Value $wantEnable -Type DWord }
        $wantPacMirror = if ($newFlags -band [SdbAi.InetProxy]::AUTO_PROXY_URL) { $newPac } else { '' }
        if ($inet.AutoConfigURL -and $inet.AutoConfigURL -ne $wantPacMirror) {
            if ($wantPacMirror) { Set-ItemProperty -Path $inetKey -Name AutoConfigURL -Value $wantPacMirror }
            else { Remove-ItemProperty -Path $inetKey -Name AutoConfigURL -ErrorAction SilentlyContinue }
        }
        if ((Test-OurProxyServer ([string]$inet.ProxyServer)) -and -not $newServer) { Set-ItemProperty -Path $inetKey -Name ProxyServer -Value '' }
        if ([string]$inet.ProxyOverride -eq $oldBypassWin -and -not $newBypass) { Set-ItemProperty -Path $inetKey -Name ProxyOverride -Value '' }
        [SdbAi.InetProxy]::Refresh()
    }
}

# --- 4) Old 127.0.0.1:8099 PAC server (fix-dingtalk-vpn-pac branch) + our CA file + backups
$legacy = @()
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ((Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'ClaudeMonitorPacServer') {
    Remove-ItemProperty -Path $runKey -Name 'ClaudeMonitorPacServer' -ErrorAction SilentlyContinue
    $legacy += 'autostart ClaudeMonitorPacServer'
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*pac-server.ps1*' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $legacy += "pac-server pid $($_.ProcessId)" } catch {} }
if (Test-Path $legacyPacFile) { Remove-Item $legacyPacFile -Force -ErrorAction SilentlyContinue; $legacy += $legacyPacFile }
if (Test-Path $caPath) { Remove-Item $caPath -Force -ErrorAction SilentlyContinue }
if ($inetCur -and (Test-Path $backupKey)) { Remove-Item -Path $backupKey -Recurse -Force -ErrorAction SilentlyContinue }

$after = $null
try { $after = [SdbAi.InetProxy]::Query($null) } catch {}
Write-Host ""
Write-Host "  SDB AI Insight proxy config removed" -ForegroundColor Green
Write-Host "  -----------------------------------" -ForegroundColor DarkGray
Write-Host "  settings.json:          $settingsMsg"
if ($clearedEnv.Count -gt 0) {
    Write-Host "  User env vars cleared:  $($clearedEnv -join ', ')"
} else {
    Write-Host "  User env vars:          none of ours were set"
}
if ($inetMsg.Count -gt 0) {
    Write-Host "  System proxy:           $($inetMsg -join '; ')"
} else {
    Write-Host "  System proxy:           nothing of ours was set"
}
if ($after) { Write-Host ("  System proxy now:       flags={0} server='{1}' pac='{2}'" -f $after[0], $after[1], $after[3]) }
if ($legacy.Count -gt 0) { Write-Host "  Old PAC server removed: $($legacy -join ', ')" }
Write-Host ""
Write-Host "  Fully QUIT Claude Desktop and reopen VS Code / terminals for the change to apply." -ForegroundColor Yellow
Write-Host "  Claude tooling now connects directly (not logged)." -ForegroundColor Cyan
Write-Host "  To re-enable: double-click install-claude-proxy.bat" -ForegroundColor DarkGray
Write-Host ""
