#Requires -Version 5
# Tiny always-on localhost PAC server for Claude Monitor.
#
# Serves the Claude-only PAC (~/.claude/claude-proxy.pac) over http://127.0.0.1:<port>.
# Why this exists: Chromium-based clients (Claude Desktop app, Chrome/Edge for
# claude.ai) and the modern WinHTTP stack REJECT file:// PAC urls, so a file://
# AutoConfigURL silently leaves those channels unproxied (= unmonitored). An
# http:// PAC is honored everywhere. Bound to loopback only, so no admin / no
# URL-ACL reservation is needed (unlike HttpListener).
#
# Started at logon by the scheduled task that install-claude-pac.bat registers.
param([int]$Port = 8099)

$pacPath = Join-Path $env:USERPROFILE ".claude\claude-proxy.pac"
$fallback = "function FindProxyForURL(url, host) { return 'DIRECT'; }"

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()

        # Drain the request so the client isn't left hanging (we serve the same
        # PAC for any path/method).
        Start-Sleep -Milliseconds 5
        if ($stream.DataAvailable) {
            $junk = New-Object byte[] 8192
            [void]$stream.Read($junk, 0, $junk.Length)
        }

        $text = if (Test-Path $pacPath) { [IO.File]::ReadAllText($pacPath) } else { $fallback }
        $body = [Text.Encoding]::UTF8.GetBytes($text)
        $head = "HTTP/1.1 200 OK`r`n" +
                "Content-Type: application/x-ns-proxy-autoconfig`r`n" +
                "Content-Length: $($body.Length)`r`n" +
                "Cache-Control: no-cache`r`n" +
                "Connection: close`r`n`r`n"
        $hb = [Text.Encoding]::ASCII.GetBytes($head)
        $stream.Write($hb, 0, $hb.Length)
        $stream.Write($body, 0, $body.Length)
        $stream.Flush()
        $stream.Close()
        $client.Close()
    } catch {
        Start-Sleep -Milliseconds 50
    }
}
