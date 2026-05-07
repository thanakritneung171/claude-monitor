#Requires -Version 5
# Set mitmproxy for Claude — persists across sessions.
# Usage: .\docker\enable-proxy.ps1
# To undo: .\docker\disable-proxy.ps1

$proxyUrl = "http://127.0.0.1:8080"
$noProxy = "localhost,127.0.0.1,github.com,gitlab.com,bitbucket.org,*.dingtalk.com"
$caCert   = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"

if (-not (Test-Path $caCert)) {
    Write-Host "  CA cert not found at: $caCert" -ForegroundColor Red
    Write-Host "  Run as Administrator first:  .\docker\install-cert.ps1" -ForegroundColor Yellow
    exit 1
}

# ── Persistent user env vars ───────────────────────────────────────────────────
[Environment]::SetEnvironmentVariable('HTTPS_PROXY',         $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('HTTP_PROXY',          $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('NO_PROXY',            $noProxy,  'User')
[Environment]::SetEnvironmentVariable('no_proxy',            $noProxy,  'User')
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', $caCert,   'User')
[Environment]::SetEnvironmentVariable('REQUESTS_CA_BUNDLE',  $caCert,   'User')
[Environment]::SetEnvironmentVariable('SSL_CERT_FILE',       $caCert,   'User')

# ── Current session ────────────────────────────────────────────────────────────
$env:HTTPS_PROXY         = $proxyUrl
$env:HTTP_PROXY          = $proxyUrl
$env:NO_PROXY            = $noProxy
$env:no_proxy            = $noProxy
$env:NODE_EXTRA_CA_CERTS = $caCert
$env:REQUESTS_CA_BUNDLE  = $caCert
$env:SSL_CERT_FILE       = $caCert

# ── Claude Code settings.json ─────────────────────────────────────────────────
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$claudeDir    = Split-Path $settingsPath -Parent
if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }

$settings = if (Test-Path $settingsPath) {
    try { Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { [PSCustomObject]@{} }
} else { [PSCustomObject]@{} }

if (-not ($settings.PSObject.Properties.Name -contains 'env')) {
    $settings | Add-Member -MemberType NoteProperty -Name 'env' -Value ([PSCustomObject]@{})
}
$e = $settings.env
foreach ($kv in @('HTTPS_PROXY', $proxyUrl), @('HTTP_PROXY', $proxyUrl), @('NODE_EXTRA_CA_CERTS', $caCert)) {
    if ($e.PSObject.Properties.Name -contains $kv[0]) { $e.($kv[0]) = $kv[1] }
    else { $e | Add-Member -MemberType NoteProperty -Name $kv[0] -Value $kv[1] }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 20), $utf8NoBom)

# ── Git bypass ─────────────────────────────────────────────────────────────────
git config --global http.https://github.com.proxy ""
git config --global http.https://gitlab.com.proxy ""

Write-Host ""
Write-Host "  Proxy ENABLED (persistent)" -ForegroundColor Green
Write-Host "  HTTPS_PROXY = $proxyUrl" -ForegroundColor Gray
Write-Host "  NO_PROXY    = $noProxy" -ForegroundColor Gray
Write-Host "  CA cert     = $caCert" -ForegroundColor Gray
Write-Host ""
Write-Host "  Restart Claude Desktop / VSCode for changes to take effect." -ForegroundColor Yellow
Write-Host "  To disable:  .\docker\disable-proxy.ps1" -ForegroundColor DarkGray
Write-Host ""
