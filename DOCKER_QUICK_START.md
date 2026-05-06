# Quick Start: Docker Deployment

## TL;DR

```bash
# Copy example env and edit
cp .env.example .env

# Start
bash start-docker.sh          # Linux/macOS
# or
.\start-docker.ps1            # Windows (PowerShell)

# Get certificate for clients
docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem
```

Then on each client machine:

```powershell
# Windows
Import-Certificate -FilePath mitmproxy-ca.pem -CertStoreLocation Cert:\CurrentUser\Root
[Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://SERVER_IP:8080", "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://SERVER_IP:8080", "User")
```

```bash
# macOS/Linux
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain mitmproxy-ca.pem
export HTTP_PROXY=http://SERVER_IP:8080
export HTTPS_PROXY=http://SERVER_IP:8080
```

---

## Files Created

| File | Purpose |
|---|---|
| `Dockerfile` | Builds mitmproxy image with addon |
| `docker-compose.yml` | Runs container with persistent certs + logs |
| `.env.example` | Template for configuration (copy to `.env`) |
| `start-docker.sh` | Startup script for Linux/macOS |
| `start-docker.ps1` | Startup script for Windows |
| `DOCKER_SETUP.md` | Full setup guide with details |

---

## What Changed

### ✅ Advantages
- ✅ Centralized mitmproxy server (not on each client machine)
- ✅ Clients just set HTTP_PROXY + import CA cert
- ✅ CA certificate persists (don't regenerate each restart)
- ✅ Docker makes deployment easy
- ✅ Logs collected on server

### ⚠️ Trade-offs
- Clients must trust server's CA certificate
- Server MUST be on same network or VPN (for cert validation)
- Single point of failure (but easy to scale)

---

## Quick Checklist

- [ ] Edit `.env` with your Cloudflare Worker URL and API key
- [ ] Run `start-docker.sh` or `start-docker.ps1`
- [ ] Extract CA certificate: `docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem`
- [ ] Distribute `mitmproxy-ca.pem` to clients
- [ ] Import certificate on each client (Windows: Trusted Root, macOS: keychain, Linux: ca-certificates)
- [ ] Set HTTP_PROXY / HTTPS_PROXY environment variables
- [ ] Restart Claude Desktop / CLI / VSCode
- [ ] Test with `curl -v https://api.anthropic.com`

---

## Verify It's Working

### On server
```bash
docker logs -f claude-monitor-proxy
# Should see mitmproxy startup logs
```

### On client (Windows)
```powershell
# Check proxy is set
$env:HTTP_PROXY

# Test
curl -v https://api.anthropic.com
# Should NOT show certificate warnings
```

---

## Troubleshooting

**Client gets "untrusted certificate" error**
→ Import the CA certificate properly (see DOCKER_SETUP.md)

**Proxy connection refused**
→ Check firewall, verify `docker ps` shows container running

**addon.py ImportError**
→ Verify `proxy/addon.py` and `proxy/config.py` are in same directory

**See logs**
```bash
docker logs -f claude-monitor-proxy
```

---

Detailed guide: [DOCKER_SETUP.md](DOCKER_SETUP.md)
