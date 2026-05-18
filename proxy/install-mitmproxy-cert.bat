@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0'); Invoke-Expression $f.Substring($f.LastIndexOf('#PSCODE')+7)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
#PSCODE
$pem = @'
-----BEGIN CERTIFICATE-----
MIIDNTCCAh2gAwIBAgIUIuV5cPg5pdIxgZ9lqlZPgE2dn08wDQYJKoZIhvcNAQEL
BQAwKDESMBAGA1UEAwwJbWl0bXByb3h5MRIwEAYDVQQKDAltaXRtcHJveHkwHhcN
MjYwNTA4MTYxNzQ3WhcNMzYwNTA3MTYxNzQ3WjAoMRIwEAYDVQQDDAltaXRtcHJv
eHkxEjAQBgNVBAoMCW1pdG1wcm94eTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBAKm4IyAlq4YA+MUE4yEJ2MNzreZ8X+d60QhpeeGXVE+cjHQbJlPZ4SNm
fymVHtDsZ173Beea35s2RnfUpM8FMWTGqE9nFDMb/bIEZ7grkMhQtBYp/hGyDrfA
4S+tzDGc8RyN5W8glLWqPC6bfwCQ/F4ZGoVP9nv4Cb8NtNJmgpY9vBrPvzbRXles
vrbPmQ2XR8pMFX7lz5aXiVBJrnsMuIOY3ISH3ZY9fHr3HsaNyu2ethZKSjW7cCmQ
otYQ+FwEdo2Nx76KeWIDA5IptpgtDPoZcDt+eHEbCydejfveEbj6gP6HESFnzMWg
046XGRvbBafE/POcu4U+JF44Aw5Q9kECAwEAAaNXMFUwDwYDVR0TAQH/BAUwAwEB
/zATBgNVHSUEDDAKBggrBgEFBQcDATAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYE
FDsviPOV7Sq0x77bK1NG/9an32T3MA0GCSqGSIb3DQEBCwUAA4IBAQBxW/WULIpS
XsJ5m8dI0YAw6w6p7ma+eYav6N4qUkL40TuwFYQPp/KeZsaWXll1jKApA4T/9H+f
FV7PXuNwHO4bc82kNUkq5ZsTm38o+tXWkU62M5M/MuSd6WejBcXHc/CY/SyVVw+y
46h3W01A8BV8aXEX2a8+kHXxgxTcyO2IxwNvbI3mI+tq/tmQJamalt3mra8wiQqx
uI3iJTxCA6hn8pF+I2oOhoNXgLAxoNilzCJPSjqQ8993B1RWcd/VawLTc0ZNlOk4
tH/yP4eYBxvwXZGx3Vf5AVo+NYh7mFfc3ljVCwNWHzx9bO1pUWfbS72MpkJt7GFG
Gb+40ofOxynL
-----END CERTIFICATE-----
'@

try {
    $b64   = ($pem -replace '-----[^-]+-----','' -replace '\s','')
    $bytes = [Convert]::FromBase64String($b64)
    $cert  = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$bytes)

    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($cert)
    $store.Close()

    Write-Host ""
    Write-Host "  mitmproxy CA imported to CurrentUser\Root" -ForegroundColor Green
    Write-Host "  Subject:     $($cert.Subject)"
    Write-Host "  Thumbprint:  $($cert.Thumbprint)"
    Write-Host "  Valid until: $($cert.NotAfter)"
    Write-Host ""
} catch {
    Write-Error "Failed to install certificate: $_"
}
