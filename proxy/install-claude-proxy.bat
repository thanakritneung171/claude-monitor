@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
$proxyUrl     = "http://10.10.84.1:8081"
$caCert       = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

# Internal hosts to bypass proxy. Without these, requests to internal services
# (GitLab on 10.16.x.x, etc.) hit mitmproxy on 10.10.84.1 and time out because
# that proxy can't route back to the internal subnet.
#   - Windows ProxyOverride uses semicolons + supports the <local> token
#   - NO_PROXY env var uses commas + supports CIDR in Node 16+/curl 7.86+
$proxyBypassWin     = "10.16.*;<local>"
$proxyBypassNoProxy = "10.16.0.0/16,localhost,127.0.0.1"

if (-not (Test-Path $caCert)) {
    Write-Host "CA cert not found. Generating via mitmdump..." -ForegroundColor Yellow

    if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
        Write-Host "  mitmdump not found - trying pip install mitmproxy..." -ForegroundColor Yellow

        function Test-RealPython {
            # Microsoft Store stub python.exe in %LOCALAPPDATA%\Microsoft\WindowsApps\ exits silently without running code.
            # A real interpreter prints "OK" and returns 0.
            param([string[]]$Cmd)
            try {
                $out = & $Cmd[0] @($Cmd | Select-Object -Skip 1) -c "print('OK')" 2>$null
                return ($LASTEXITCODE -eq 0 -and ($out -join '') -match 'OK')
            } catch { return $false }
        }
        function Get-PipRunner {
            if (Get-Command pip -ErrorAction SilentlyContinue) {
                # Check the python that owns this pip is real
                try { & pip --version 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { return ,@('pip') } } catch {}
            }
            if (Get-Command py     -ErrorAction SilentlyContinue) { if (Test-RealPython @('py'))     { return ,@('py','-m','pip') } }
            if (Get-Command python -ErrorAction SilentlyContinue) { if (Test-RealPython @('python')) { return ,@('python','-m','pip') } }
            return $null
        }
        function Get-PythonRunner {
            if (Get-Command py     -ErrorAction SilentlyContinue) { if (Test-RealPython @('py'))     { return ,@('py') } }
            if (Get-Command python -ErrorAction SilentlyContinue) { if (Test-RealPython @('python')) { return ,@('python') } }
            return $null
        }

        function Install-Winget {
            $stage = Join-Path $env:TEMP "winget-bootstrap-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
            New-Item -ItemType Directory -Path $stage -Force | Out-Null
            try {
                $vclibs = Join-Path $stage 'vclibs.appx'
                Invoke-WebRequest -Uri 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx' -OutFile $vclibs -UseBasicParsing
                try { Add-AppxPackage -Path $vclibs -ErrorAction Stop } catch { Write-Host "    VCLibs: $_" -ForegroundColor DarkGray }

                $xaml = Join-Path $stage 'xaml.appx'
                Invoke-WebRequest -Uri 'https://github.com/microsoft/microsoft-ui-xaml/releases/download/v2.8.6/Microsoft.UI.Xaml.2.8.x64.appx' -OutFile $xaml -UseBasicParsing
                try { Add-AppxPackage -Path $xaml -ErrorAction Stop } catch { Write-Host "    UI.Xaml: $_" -ForegroundColor DarkGray }

                # Resolve latest winget msixbundle from GitHub releases
                $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/microsoft/winget-cli/releases/latest' -UseBasicParsing
                $msixUrl = ($release.assets | Where-Object { $_.name -like '*.msixbundle' } | Select-Object -First 1).browser_download_url
                if (-not $msixUrl) { throw 'msixbundle URL not found in latest winget release' }

                $bundle = Join-Path $stage 'winget.msixbundle'
                Invoke-WebRequest -Uri $msixUrl -OutFile $bundle -UseBasicParsing
                Add-AppxPackage -Path $bundle -ErrorAction Stop

                # winget lives in %LOCALAPPDATA%\Microsoft\WindowsApps which is usually on PATH; refresh just in case.
                $machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
                $userPath1   = [Environment]::GetEnvironmentVariable('PATH', 'User')
                $env:PATH    = "$machinePath;$userPath1"
            } finally {
                Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
            }
        }

        $pip = Get-PipRunner
        if (-not $pip) {
            Write-Host "  Python not found - attempting auto-install via winget..." -ForegroundColor Yellow
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
                Write-Host "  winget not found - bootstrapping winget first..." -ForegroundColor Yellow
                try { Install-Winget } catch {
                    Write-Error "Failed to bootstrap winget: $_. Install Python 3.12 manually from https://python.org then re-run."
                    return
                }
                if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
                    Write-Error "winget still not on PATH after bootstrap. Open a new terminal and re-run, or install Python 3.12 manually from https://python.org."
                    return
                }
                Write-Host "  winget installed." -ForegroundColor Green
            }
            & winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent
            if ($LASTEXITCODE -ne 0) {
                Write-Error "winget failed to install Python (exit $LASTEXITCODE). Install Python 3.12 manually from https://python.org then re-run."
                return
            }

            # winget writes the new install into User PATH but the current process won't pick it up. Rebuild $env:PATH from the registry.
            $machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
            $userPath0   = [Environment]::GetEnvironmentVariable('PATH', 'User')
            $env:PATH    = "$machinePath;$userPath0"

            $pip = Get-PipRunner
            if (-not $pip) {
                Write-Error "Python installed via winget but not visible on PATH yet. Open a new terminal and re-run this installer."
                return
            }
            Write-Host "  Python installed via winget." -ForegroundColor Green
        }

        Write-Host "  Running: $($pip -join ' ') install mitmproxy" -ForegroundColor DarkGray
        & $pip[0] @($pip | Select-Object -Skip 1) install mitmproxy
        if ($LASTEXITCODE -ne 0) {
            Write-Error "pip install mitmproxy failed (exit $LASTEXITCODE). Scroll up for pip's error output, then re-run."
            return
        }

        if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
            # pip's Scripts dir often isn't on PATH (Microsoft Store Python installs to %APPDATA%\Python\Python3xx\Scripts).
            # Probe both global and per-user Scripts dirs, then add to current session + persistent User PATH.
            $py = Get-PythonRunner
            $probe = "import sysconfig, os; print(sysconfig.get_path('scripts')); print(sysconfig.get_path('scripts', os.name + '_user'))"
            $dirs = @()
            if ($py) {
                try { $dirs = (& $py[0] @($py | Select-Object -Skip 1) -c $probe 2>$null) -split "`r?`n" | Where-Object { $_.Trim() } } catch {}
            }
            # Fallback: probe common Windows install locations in case sysconfig probe failed
            $dirs += @(
                "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts",
                "$env:LOCALAPPDATA\Programs\Python\Python311\Scripts",
                "$env:LOCALAPPDATA\Programs\Python\Python310\Scripts",
                "$env:APPDATA\Python\Python312\Scripts",
                "$env:APPDATA\Python\Python311\Scripts",
                "$env:APPDATA\Python\Python310\Scripts"
            )
            $dirs += Get-ChildItem "$env:LOCALAPPDATA\Packages\PythonSoftwareFoundation.Python.*\LocalCache\local-packages\Python*\Scripts" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }

            $scriptsDir = $null
            foreach ($d in $dirs) {
                $d = $d.Trim()
                if (Test-Path (Join-Path $d 'mitmdump.exe')) {
                    $scriptsDir = $d
                    break
                }
            }

            if ($scriptsDir) {
                Write-Host "  Found mitmdump in $scriptsDir - adding to PATH..." -ForegroundColor Yellow
                $env:PATH = "$scriptsDir;$env:PATH"
                $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
                if (-not $userPath) { $userPath = '' }
                if (";$userPath;" -notlike "*;$scriptsDir;*") {
                    [Environment]::SetEnvironmentVariable('PATH', "$scriptsDir;$userPath", 'User')
                }
            }

            if (-not (Get-Command mitmdump -ErrorAction SilentlyContinue)) {
                Write-Error "Failed to install mitmproxy. Run 'pip install mitmproxy' manually, then re-run."
                return
            }
        }
    }

    # Start mitmdump briefly on a throwaway port so it bootstraps the CA cert,
    # then kill it. The cert is written to ~/.mitmproxy/ on first launch.
    $tmpProc = Start-Process -FilePath "mitmdump" -ArgumentList "--listen-port","18080","-q" -WindowStyle Hidden -PassThru
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $caCert) { break }
    }
    try { Stop-Process -Id $tmpProc.Id -Force -ErrorAction SilentlyContinue } catch {}

    if (-not (Test-Path $caCert)) {
        Write-Error "Failed to generate CA cert. Try running 'mitmdump' manually once, then re-run."
        return
    }
    Write-Host "  CA cert generated at: $caCert" -ForegroundColor Green
}

$claudeDir = Split-Path $settingsPath -Parent
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

if (Test-Path $settingsPath) {
    $raw = Get-Content $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $settings = [PSCustomObject]@{}
    } else {
        try {
            $settings = $raw | ConvertFrom-Json
        } catch {
            Write-Error "Failed to parse $settingsPath as JSON. Fix or remove it, then re-run."
            return
        }
    }
} else {
    $settings = [PSCustomObject]@{}
}

function Set-Prop {
    param($Object, [string]$Name, $Value)
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    } else {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

if ($settings.PSObject.Properties.Name -contains 'env') {
    $envBlock = $settings.env
} else {
    $envBlock = [PSCustomObject]@{}
    Set-Prop $settings 'env' $envBlock
}

Set-Prop $envBlock 'HTTPS_PROXY'         $proxyUrl
Set-Prop $envBlock 'HTTP_PROXY'          $proxyUrl
Set-Prop $envBlock 'NO_PROXY'            $proxyBypassNoProxy
Set-Prop $envBlock 'NODE_EXTRA_CA_CERTS' $caCert

$json      = $settings | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)

[Environment]::SetEnvironmentVariable('HTTPS_PROXY',         $proxyUrl,           'User')
[Environment]::SetEnvironmentVariable('HTTP_PROXY',          $proxyUrl,           'User')
[Environment]::SetEnvironmentVariable('NO_PROXY',            $proxyBypassNoProxy, 'User')
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', $caCert,             'User')
[Environment]::SetEnvironmentVariable('REQUESTS_CA_BUNDLE',  $caCert,             'User')
[Environment]::SetEnvironmentVariable('SSL_CERT_FILE',       $caCert,             'User')

# Windows system proxy bypass — Edge/Chrome/.NET apps use WinINET registry,
# not env vars, so they need a separate ProxyOverride entry.
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty -Path $regPath -Name ProxyOverride -Value $proxyBypassWin

Write-Host ""
Write-Host "  Claude proxy config installed" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  Claude Code settings.json: $settingsPath"
Write-Host "  Persistent user env vars:  HTTPS_PROXY, HTTP_PROXY, NO_PROXY,"
Write-Host "                             NODE_EXTRA_CA_CERTS, REQUESTS_CA_BUNDLE, SSL_CERT_FILE"
Write-Host "  Proxy URL:                 $proxyUrl"
Write-Host "  Proxy bypass (NO_PROXY):   $proxyBypassNoProxy"
Write-Host "  Proxy bypass (WinINET):    $proxyBypassWin"
Write-Host "  CA cert:                   $caCert"
Write-Host ""
Write-Host "  IMPORTANT: Fully QUIT Claude Desktop (system tray -> Quit) and reopen" -ForegroundColor Yellow
Write-Host "             so Cowork's worker process inherits the new env vars." -ForegroundColor Yellow
Write-Host "  Open a new terminal and run 'claude' - Claude Code will pick up the proxy." -ForegroundColor Cyan
Write-Host "  Make sure mitmproxy is running (proxy\start.ps1) before using anything." -ForegroundColor Yellow
Write-Host ""
