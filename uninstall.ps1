#Requires -Version 5
# Claude Monitor — Complete Uninstaller
# Usage: Right-click → "Run with PowerShell"  OR  .\uninstall.ps1

$ErrorActionPreference = "Continue"
$here = $PSScriptRoot

# ── Helpers ────────────────────────────────────────────────────────────────────
function Write-Step { param([int]$n, [int]$total, [string]$msg) Write-Host ("  [{0}/{1}] {2}" -f $n, $total, $msg) -ForegroundColor Cyan }
function Write-OK   { param([string]$msg) Write-Host "         OK  $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "        SKIP $msg" -ForegroundColor Yellow }

# ── Banner ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║      Claude Monitor  Uninstaller     ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# Confirm
$confirm = Read-Host "  This will remove proxy config, env vars, and CA cert. Continue? [y/N]"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "  Cancelled." -ForegroundColor Yellow
    Read-Host "  Press Enter to close"
    exit 0
}
Write-Host ""

$total = 5

# ── Step 1: Stop running proxy ─────────────────────────────────────────────────
Write-Step 1 $total "Stopping running proxy (mitmdump)"
$procs = Get-Process mitmdump -ErrorAction SilentlyContinue
if ($procs) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-OK "Stopped $($procs.Count) mitmdump process(es)"
} else {
    Write-Warn "No mitmdump process running"
}

# ── Step 2: Remove proxy config from settings.json ────────────────────────────
Write-Step 2 $total "Removing proxy config from Claude Code settings.json"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$proxyKeys    = @('HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS')

if (-not (Test-Path $settingsPath)) {
    Write-Warn "settings.json not found: $settingsPath"
} else {
    $raw = Get-Content $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        Write-Warn "settings.json is empty"
    } else {
        try {
            $settings = $raw | ConvertFrom-Json
            $removed  = @()

            if ($settings.PSObject.Properties.Name -contains 'env') {
                $envBlock = $settings.env
                foreach ($key in $proxyKeys) {
                    if ($envBlock.PSObject.Properties.Name -contains $key) {
                        $envBlock.PSObject.Properties.Remove($key)
                        $removed += $key
                    }
                }
                # Drop empty env block
                if ($envBlock.PSObject.Properties.Name.Count -eq 0) {
                    $settings.PSObject.Properties.Remove('env')
                }
            }

            if ($removed.Count -gt 0) {
                $utf8NoBom = New-Object System.Text.UTF8Encoding $false
                [System.IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 20), $utf8NoBom)
                Write-OK "Removed keys: $($removed -join ', ')"
            } else {
                Write-Warn "No proxy keys found in settings.json env block"
            }
        } catch {
            Write-Host "        FAIL Could not parse settings.json — skip" -ForegroundColor Red
        }
    }
}

# ── Step 3: Clear persistent user environment variables ───────────────────────
Write-Step 3 $total "Clearing user environment variables"
$envKeys  = @('HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE')
$cleared  = @()

foreach ($key in $envKeys) {
    if ([Environment]::GetEnvironmentVariable($key, 'User')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'User')
        $cleared += $key
    }
}

if ($cleared.Count -gt 0) {
    Write-OK "Cleared: $($cleared -join ', ')"
} else {
    Write-Warn "No proxy env vars found"
}

# ── Step 4: Remove CA cert from Trusted Root (UAC) ────────────────────────────
Write-Step 4 $total "Removing mitmproxy CA cert from Trusted Root"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

$certRemoveScript = @'
$certs = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'mitmproxy' }
if ($certs) {
    $certs | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host ("  Removed {0} certificate(s) from Trusted Root" -f $certs.Count) -ForegroundColor Green
} else {
    Write-Host "  mitmproxy CA cert not found in Trusted Root (already removed?)" -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
'@

$tempPs1 = [System.IO.Path]::GetTempPath() + "mitm-cert-remove-$PID.ps1"

if ($isAdmin) {
    $certs = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'mitmproxy' }
    if ($certs) {
        $certs | Remove-Item -Force -ErrorAction SilentlyContinue
        Write-OK "Removed $($certs.Count) certificate(s) from Trusted Root"
    } else {
        Write-Warn "mitmproxy CA cert not found in Trusted Root"
    }
} else {
    Write-Host "         A UAC prompt will appear — click Yes to remove the cert." -ForegroundColor Yellow
    Set-Content -Path $tempPs1 -Value $certRemoveScript -Encoding UTF8
    $proc = Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempPs1`"" -Verb RunAs -Wait -PassThru -ErrorAction SilentlyContinue
    Remove-Item $tempPs1 -ErrorAction SilentlyContinue
    if ($proc -and $proc.ExitCode -eq 0) {
        Write-OK "CA cert removal completed"
    } else {
        Write-Warn "UAC denied or removal failed — remove manually via certmgr.msc (Trusted Root)"
    }
}

# ── Step 5: Optional — uninstall mitmproxy ────────────────────────────────────
Write-Step 5 $total "Removing mitmproxy (optional)"
$removeMitm = Read-Host "         Uninstall mitmproxy from Python? [y/N]"
if ($removeMitm -eq 'y' -or $removeMitm -eq 'Y') {
    if (Get-Command pip -ErrorAction SilentlyContinue) {
        pip uninstall mitmproxy -y
        Write-OK "mitmproxy uninstalled"
    } else {
        Write-Warn "pip not found — skip"
    }
} else {
    Write-Warn "Skipped (mitmproxy kept)"
}

# ── Optional: remove cert files ───────────────────────────────────────────────
$removeCertFiles = Read-Host "         Remove ~/.mitmproxy cert files? [y/N]"
if ($removeCertFiles -eq 'y' -or $removeCertFiles -eq 'Y') {
    $mitmDir = Join-Path $env:USERPROFILE ".mitmproxy"
    if (Test-Path $mitmDir) {
        Remove-Item $mitmDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-OK "Removed: $mitmDir"
    } else {
        Write-Warn "~/.mitmproxy not found"
    }
} else {
    Write-Warn "Skipped"
}

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║      Uninstall complete!             ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Claude Desktop will connect directly to Anthropic after restart." -ForegroundColor White
Write-Host "  Quit Claude Desktop fully (system tray → Quit) and reopen." -ForegroundColor Yellow
Write-Host ""
Write-Host "  To reinstall:  .\install.ps1" -ForegroundColor DarkGray
Write-Host ""

Read-Host "  Press Enter to close"
