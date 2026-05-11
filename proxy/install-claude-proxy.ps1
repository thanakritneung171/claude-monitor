#Requires -Version 5
# One-time setup for routing Claude through mitmproxy:
#   1) Writes proxy + CA cert config into Claude Code's settings.json
#      → Claude Code CLI / VSCode pick this up in any new terminal.
#   2) Sets persistent USER env vars (HTTPS_PROXY, NODE_EXTRA_CA_CERTS, ...)
#      → Claude Desktop subprocess (Cowork worker etc.) inherit them on launch.
#        Without this, Cowork's worker process bypasses the system proxy and
#        connects directly to Anthropic IPs (160.79.104.x), invisible to mitm.
#
# Run once:
#     .\install-claude-proxy.ps1
#
# NOTE: mitmproxy must be running on 127.0.0.1:8080 whenever you use Claude
# tooling — otherwise requests will fail with ECONNREFUSED.
# To revert: .\uninstall-claude-proxy.ps1

$proxyUrl     = "http://10.10.84.1:8081"
$caCert       = Join-Path $env:USERPROFILE ".mitmproxy\mitmproxy-ca-cert.pem"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

if (-not (Test-Path $caCert)) {
    Write-Error "CA cert not found at $caCert — run mitmproxy at least once to generate it."
    return
}

# Ensure ~/.claude exists
$claudeDir = Split-Path $settingsPath -Parent
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Load existing settings (preserve other keys) or start fresh
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

# Get or create the env block
if ($settings.PSObject.Properties.Name -contains 'env') {
    $envBlock = $settings.env
} else {
    $envBlock = [PSCustomObject]@{}
    Set-Prop $settings 'env' $envBlock
}

Set-Prop $envBlock 'HTTPS_PROXY'         $proxyUrl
Set-Prop $envBlock 'HTTP_PROXY'          $proxyUrl
Set-Prop $envBlock 'NODE_EXTRA_CA_CERTS' $caCert

# Write back as UTF-8 without BOM (safer for cross-tool JSON readers)
$json      = $settings | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8NoBom)

# Persistent user env vars — required so Claude Desktop subprocesses (Cowork
# worker, agent helpers) inherit proxy config when launched from the Start menu.
[Environment]::SetEnvironmentVariable('HTTPS_PROXY',         $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('HTTP_PROXY',          $proxyUrl, 'User')
[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS', $caCert,   'User')
[Environment]::SetEnvironmentVariable('REQUESTS_CA_BUNDLE',  $caCert,   'User')
[Environment]::SetEnvironmentVariable('SSL_CERT_FILE',       $caCert,   'User')

Write-Host ""
Write-Host "  Claude proxy config installed" -ForegroundColor Green
Write-Host "  -------------------------------------" -ForegroundColor DarkGray
Write-Host "  Claude Code settings.json: $settingsPath"
Write-Host "  Persistent user env vars:  HTTPS_PROXY, HTTP_PROXY, NODE_EXTRA_CA_CERTS,"
Write-Host "                             REQUESTS_CA_BUNDLE, SSL_CERT_FILE"
Write-Host "  Proxy URL:                 $proxyUrl"
Write-Host "  CA cert:                   $caCert"
Write-Host ""
Write-Host "  IMPORTANT: Fully QUIT Claude Desktop (system tray → Quit) and reopen" -ForegroundColor Yellow
Write-Host "             so Cowork's worker process inherits the new env vars." -ForegroundColor Yellow
Write-Host "  Open a new terminal and run 'claude' — Claude Code will pick up the proxy." -ForegroundColor Cyan
Write-Host "  Make sure mitmproxy is running (proxy\start.ps1) before using anything." -ForegroundColor Yellow
Write-Host ""
