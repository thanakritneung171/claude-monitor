# Centralized mitmproxy on Docker

## โครงสร้าง

```
┌─────────────────────────────────────────┐
│      Docker Host (Server)               │
│  ┌──────────────────────────────────┐   │
│  │ mitmproxy:8080 + addon.py        │   │
│  │ (listen 0.0.0.0)                │   │
│  └──────────────────────────────────┘   │
│              ↑                            │
│  HTTPS_PROXY=http://server-ip:8080      │
│  HTTP_PROXY=http://server-ip:8080       │
│              ↑                            │
│  ┌────────────────────────────────────┐  │
│  │ Client Machines                     │  │
│  │ • Windows/Mac/Linux                 │  │
│  │ • Claude Desktop / CLI / VSCode     │  │
│  │ • Trust server CA certificate       │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## ขั้นตอนการติดตั้ง

### ฝั่ง Server

#### 1. Start Docker container
```bash
docker-compose up -d
```

Container จะเริ่มและสร้าง CA certificate ที่ `/root/.mitmproxy` (persist ใน volume)

#### 2. ดึง CA certificate ออกมา
```bash
# วิธี 1: Copy จาก Docker volume
docker exec claude-monitor-proxy cat /root/.mitmproxy/mitmproxy-ca.pem > mitmproxy-ca.pem

# วิธี 2: ใช้ Docker volume inspect
docker inspect mitmproxy-certs
```

`mitmproxy-ca.pem` = CA public certificate ที่ clients ต้อง trust

#### 3. Share certificate กับ clients
- เก็บไว้ที่เซิร์ฟเวอร์ (HTTP server หรือ cloud storage)
- หรือ email/Git ส่งให้

---

### ฝั่ง Client (Windows)

#### 1. ดาวน์โหลด CA certificate
```powershell
# ตัวอย่าง
curl -O http://server-ip/mitmproxy-ca.pem
```

#### 2. Install certificate ใน Trusted Root
```powershell
# PowerShell (admin)
Import-Certificate -FilePath .\mitmproxy-ca.pem -CertStoreLocation Cert:\CurrentUser\Root
```

หรือ GUI:
- Right-click `mitmproxy-ca.pem` → Install Certificate
- Store Location: **Current User**
- Certificate Store: **Trusted Root Certification Authorities**

#### 3. ตั้ง proxy environment variables
```powershell
# PowerShell (user or system environment)
[Environment]::SetEnvironmentVariable("HTTP_PROXY", "http://server-ip:8080", "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://server-ip:8080", "User")
[Environment]::SetEnvironmentVariable("ALL_PROXY", "http://server-ip:8080", "User")

# Verify
$env:HTTP_PROXY
```

หรือ **System Properties** → Advanced → Environment Variables

#### 4. Restart applications
- Claude Desktop
- Claude Code CLI/VSCode
- ฯลฯ

---

### ฝั่ง Client (macOS / Linux)

#### 1. Install certificate
```bash
# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain mitmproxy-ca.pem

# Linux (Ubuntu/Debian)
sudo cp mitmproxy-ca.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

#### 2. ตั้ง proxy environment variables
```bash
export HTTP_PROXY=http://server-ip:8080
export HTTPS_PROXY=http://server-ip:8080
export ALL_PROXY=http://server-ip:8080

# Add to ~/.bashrc หรือ ~/.zshrc
echo 'export HTTP_PROXY=http://server-ip:8080' >> ~/.bashrc
source ~/.bashrc
```

#### 3. Restart applications

---

## ข้อจำกัดและเรื่องสำคัญ

### ⚠️ Certificate Pinning
บางแอพ (เช่น Claude Desktop) อาจมี **pinning** — ตรวจสอบ cert ของ api.anthropic.com โดยตรง

**วิธีแก้:** 
- อาจต้องแก้ `addon.py` เพื่อ bypass pinning
- หรือใช้ mitmproxy's `--ignore-hosts` แล้ว route แบบอื่น

### ⚠️ Network Security
- mitmproxy listens บน `0.0.0.0:8080` — ต้องทำ firewall rules ให้ดี
- ถ้า server exposed บน internet ต้องใช้ VPN/bastion

**แนะนำ:**
```bash
# ใน docker-compose: เปลี่ยน ports
ports:
  - "127.0.0.1:8080:8080"  # Local only
```

แล้วใช้ SSH tunnel หรือ VPN สำหรับ clients

### ⚠️ Performance
- mitmproxy single-threaded บน addon → อาจช้าถ้า concurrent requests เยอะ
- Monitor memory usage:
```bash
docker stats claude-monitor-proxy
```

---

## Troubleshooting

### Certificate trust issues
```bash
# Verify certificate chain
openssl x509 -in mitmproxy-ca.pem -text -noout

# Check if client trusts it
curl -v https://api.anthropic.com
```

### Proxy not working
```bash
# ใน Windows cmd
set HTTP_PROXY
set HTTPS_PROXY

# ตรวจ logs
docker logs -f claude-monitor-proxy
```

### addon.py errors
```bash
# Check addon syntax
python -m py_compile proxy/addon.py

# Tail logs
docker logs -f claude-monitor-proxy
```

---

## Monitoring

### View logs real-time
```bash
docker logs -f claude-monitor-proxy
```

### Check local JSONL logs
```bash
# ใน server
cat log/claude_2026-05-06.jsonl | head -5
```

### Check container stats
```bash
docker stats claude-monitor-proxy
```

---

## Stop / Update

### Stop
```bash
docker-compose down
```

### Update addon.py
```bash
# Edit proxy/addon.py
docker-compose up -d --build
```

### Reset certificates (ต้องให้ clients ติดตั้งใหม่)
```bash
docker volume rm mitmproxy-certs
docker-compose up -d
```

---

## Next Steps

- [ ] Firewall rules สำหรับ server
- [ ] Setup HTTPS สำหรับ mitmproxy (optional)
- [ ] Load balancing ถ้า traffic เยอะ (nginx in front)
- [ ] Monitoring dashboard (Grafana)
