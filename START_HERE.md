# START HERE 🚀

## Status
- ✅ Docker files ready
- ✅ .env configured
- ✅ All scripts prepared

---

## ขั้นตอน 1️⃣: Install Docker (ถ้ายังไม่มี)

1. ดาวน์โหลด [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Install และ start Docker Desktop
3. Verify:
   ```powershell
   docker --version
   docker ps
   ```

---

## ขั้นตอน 2️⃣: Build & Start

**Windows (PowerShell):**
```powershell
cd "c:\Users\Thanakrit_C\Desktop\Log Prompt\claude-monitor"
.\setup.cmd
```

**Windows (Command Prompt):**
```cmd
setup.cmd
```

**Linux/macOS:**
```bash
bash start-docker.sh
```

---

## ขั้นตอน 3️⃣: Verify Running

```bash
docker ps
# ควรเห็น: claude-monitor-proxy (running)

docker logs -f claude-monitor-proxy
# ควรเห็น: mitmproxy startup logs
```

---

## ขั้นตอน 4️⃣: Extract CA Certificate

ให้ clients ไว้ใจเซิร์ฟเวอร์นี้:

```bash
docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem
```

ตอนนี้ `mitmproxy-ca.pem` พร้อมส่งให้ clients

---

## ขั้นตอน 5️⃣: Setup Clients

### Windows Client

**A. Import Certificate:**
```powershell
# Admin PowerShell
Import-Certificate -FilePath .\mitmproxy-ca.pem -CertStoreLocation Cert:\CurrentUser\Root
```

หรือ GUI:
- Right-click `mitmproxy-ca.pem`
- Select "Install Certificate"
- Choose "Current User" → "Trusted Root Certification Authorities"

**B. Set Proxy Environment Variables:**
```powershell
[Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://SERVER_IP:8080", "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://SERVER_IP:8080", "User")
```

Replace `SERVER_IP` with actual server IP

**C. Verify:**
```powershell
$env:HTTP_PROXY
# Should show: http://SERVER_IP:8080
```

**D. Restart Applications:**
- Close Claude Desktop
- Close Claude Code / VSCode
- Restart them

---

### macOS Client

**A. Import Certificate:**
```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain mitmproxy-ca.pem
```

**B. Set Environment Variables (bash/zsh):**
```bash
echo 'export HTTP_PROXY=http://SERVER_IP:8080' >> ~/.zshrc
echo 'export HTTPS_PROXY=http://SERVER_IP:8080' >> ~/.zshrc
source ~/.zshrc
```

**C. Verify:**
```bash
echo $HTTP_PROXY
# Should show: http://SERVER_IP:8080
```

**D. Restart Applications**

---

### Linux Client

**A. Import Certificate:**
```bash
sudo cp mitmproxy-ca.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

**B. Set Environment Variables:**
```bash
echo 'export HTTP_PROXY=http://SERVER_IP:8080' >> ~/.bashrc
echo 'export HTTPS_PROXY=http://SERVER_IP:8080' >> ~/.bashrc
source ~/.bashrc
```

**C. Verify:**
```bash
echo $HTTP_PROXY
```

**D. Restart Applications**

---

## ขั้นตอน 6️⃣: Test It Works

### On Client:
```bash
# Should NOT show certificate warning
curl -v https://api.anthropic.com

# Or test Claude Desktop/Code
# Try a conversation and check server logs
```

### On Server:
```bash
# Watch logs
docker logs -f claude-monitor-proxy

# Check local files (optional)
cat log/claude_2026-05-06.jsonl
```

---

## Current Configuration

| Setting | Value |
|---|---|
| Proxy Port | 8080 |
| Worker URL | https://claude-monitor-hooks.cloudflare-training3.workers.dev |
| API Key | Softdebut888 |
| Email Filter | Disabled |

---

## Useful Commands

```bash
# View logs
docker logs -f claude-monitor-proxy

# Stop
docker-compose down

# Restart
docker-compose up -d

# Remove and rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Extract CA cert
docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Docker not running | Open Docker Desktop and wait for it to start |
| Port 8080 in use | Change PROXY_PORT in .env and rebuild |
| Certificate rejected | Make sure CA cert is imported in Trusted Root |
| Proxy not working | Check HTTP_PROXY env var is set and firewall allows 8080 |
| addon.py errors | Check `docker logs -f claude-monitor-proxy` |

---

## 📚 Full Documentation

- [DOCKER_SETUP.md](DOCKER_SETUP.md) — Detailed setup guide
- [DOCKER_QUICK_START.md](DOCKER_QUICK_START.md) — Quick reference
- [DOCKER_PREREQUISITES.md](DOCKER_PREREQUISITES.md) — Pre-flight checklist

---

**Ready?** Run `setup.cmd` (Windows) or `bash start-docker.sh` (Linux/macOS) → Then follow Step 4+ ✅
