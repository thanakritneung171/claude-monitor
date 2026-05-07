#Requires -Version 5
# Remove mitmproxy config — persists across sessions.
# Usage: .\docker\disable-proxy.ps1

$envKeys = @('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'no_proxy',
             'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE')

# ── Clear persistent user env vars ────────────────────────────────────────────
foreach ($key in $envKeys) {
    [Environment]::SetEnvironmentVariable($key, $null, 'User')
    Set-Item "env:$key" "" -ErrorAction SilentlyContinue
}

# ── Claude Code settings.json ─────────────────────────────────────────────────
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
if (Test-Path $settingsPath) {
    try {
        $settings = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($settings.PSObject.Properties.Name -contains 'env') {
            $e = $settings.env
            foreach ($key in @('HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS')) {
                $e.PSObject.Properties.Remove($key)
            }
            if ($e.PSObject.Properties.Name.Count -eq 0) {
                $settings.PSObject.Properties.Remove('env')
            }
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 20), $utf8NoBom)
        }
    } catch { }
}

# ── Git bypass ────────────────────────────────────────────────────────────────
git config --global --unset http.https://github.com.proxy 2>$null
git config --global --unset http.https://gitlab.com.proxy 2>$null

Write-Host ""
Write-Host "  Proxy DISABLED (persistent)" -ForegroundColor Yellow
Write-Host "  Restart Claude Desktop / VSCode for changes to take effect." -ForegroundColor Gray
Write-Host "  To re-enable:  .\docker\enable-proxy.ps1" -ForegroundColor DarkGray
Write-Host ""
