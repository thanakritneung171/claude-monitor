# คู่มือติดตั้งและใช้งาน 🚀

## สิ่งที่ต้องมีก่อน

- **Python 3.9+** พร้อม pip
- **mitmproxy 9.0+** (ติดตั้งผ่าน `pip install mitmproxy`)
- **Node.js + npm** (สำหรับ deploy Worker)
- **Cloudflare Account** ที่เปิดใช้ Workers + D1
- **Wrangler CLI** (`npm i -g wrangler`)

---

## ขั้นตอนที่ 1: ตั้งค่า Cloudflare Worker

### 1a. สร้าง D1 Database

```powershell
cd worker
wrangler d1 create claude-monitor
```

จะได้ database ID เช่น `12345678-...` — จดไว้

### 1b. สร้างตาราง

```powershell
wrangler d1 execute claude-monitor --remote --command "
CREATE TABLE IF NOT EXISTS api_logs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  client TEXT,
  account_email TEXT,
  machine_name TEXT,
  model TEXT,
  prompt TEXT,
  prompt_chars INTEGER,
  response_chars INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_ts    ON api_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_model ON api_logs(model);
CREATE INDEX IF NOT EXISTS idx_email ON api_logs(account_email);
CREATE INDEX IF NOT EXISTS idx_client ON api_logs(client);
"
```

### 1c. แก้ไข `worker/wrangler.toml`

```toml
name = "claude-monitor"
main = "src/index.ts"
compatibility_date = "2024-11-21"

[[d1_databases]]
binding = "DB"
database_id = "YOUR_DATABASE_ID"   # ← ใส่ ID จาก 1a
database_name = "claude-monitor"
```

### 1d. ตั้ง API Key

```powershell
wrangler secret put API_KEY
# พิมพ์ key ที่ต้องการ เช่น MySecretKey123
```

### 1e. Deploy

```powershell
cd worker
npm install
npm run deploy
```

ได้ URL เช่น `https://claude-monitor-xxx.workers.dev`

---

## ขั้นตอนที่ 2: ตั้งค่า Proxy Addon

### 2a. คัดลอก config

```powershell
cd proxy
Copy-Item config.example.py config.py
```

### 2b. แก้ไข `proxy/config.py`

```python
WORKER_URL = "https://claude-monitor-xxx.workers.dev"
API_KEY    = "MySecretKey123"   # ต้องตรงกับที่ตั้งใน 1d
PROXY_PORT = 8080
```

### 2c. (ถ้าต้องการ) ตั้ง email filter

แก้ไขใน `proxy/addon.py` (ตัวแปรอยู่ด้านบนสุด ราวบรรทัด 38):

```python
EMAIL_FILTER_ENABLED   = True              # True = กรอง / False = log ทั้งหมด
EMAIL_FILTER_SUBSTRING = "@yourcompany"    # case-insensitive substring
```

---

## ขั้นตอนที่ 3: รัน mitmproxy ครั้งแรก (สร้าง CA cert)

```powershell
mitmdump --listen-port 8080
# กด Ctrl+C ทันที — แค่ต้องการให้สร้าง CA cert
```

จะได้ไฟล์ `~/.mitmproxy/mitmproxy-ca-cert.pem`

---

## ขั้นตอนที่ 4: ติดตั้ง CA Certificate

### Windows (PowerShell Admin)

```powershell
Import-Certificate `
  -FilePath "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem" `
  -CertStoreLocation Cert:\CurrentUser\Root
```

### macOS

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  ~/.mitmproxy/mitmproxy-ca-cert.pem
```

### Linux

```bash
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

---

## ขั้นตอนที่ 5: ตั้งค่า System Proxy + Persistent Env Vars

### Windows — ใช้ `install-claude-proxy.ps1` (แนะนำ)

```powershell
cd proxy
.\install-claude-proxy.ps1
```

Script นี้ตั้งให้ครบ 2 อย่าง:
1. **`~/.claude/settings.json`** → Claude Code CLI / VSCode ใช้
2. **Persistent user env vars** (HTTPS_PROXY, NODE_EXTRA_CA_CERTS, ฯลฯ) → **Cowork worker subprocess** จะ inherit ทันทีที่เปิด Claude Desktop

> ⚠️ **สำคัญ:** ปิด Claude Desktop ให้สิ้น (system tray → Quit) แล้วเปิดใหม่เพื่อให้ subprocess ได้ env ใหม่ — ไม่งั้น Cowork จะ bypass proxy

### macOS / Linux

ตั้งใน `~/.bashrc` หรือ `~/.zshrc`:

```bash
export HTTPS_PROXY=http://127.0.0.1:8080
export HTTP_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export REQUESTS_CA_BUNDLE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export SSL_CERT_FILE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
```

### Windows — เลิกใช้ proxy

```powershell
cd proxy
.\uninstall-claude-proxy.ps1
```

ลบทั้ง settings.json env block และ user env vars

---

## ขั้นตอนที่ 6: เปิด Claude Monitor

```powershell
cd proxy
.\start.ps1
```

`start.ps1` จะรัน mitmdump พร้อม `--allow-hosts (anthropic\.com|claude\.ai|claudeusercontent\.com)` — ดักทุก subdomain ของ Anthropic/Claude

**ผลลัพธ์ที่ควรเห็นใน console:**

```
[claude-monitor] email filter ON — only logging accounts containing '@softdebut'
[claude-conn] SNI seen: claude.ai
[claude-conn] SNI seen: api.anthropic.com
[claude-account] ✓ detected email: user@softdebut.com (from /api/auth/current_account)
[claude-api] claude-desktop-cowork | claude-sonnet-4-6 | in=3 out=23 | $0.09204
[claude-desktop] claude-sonnet-4-6 | prompt=145ch | in=1567 out=789 | $0.00234
```

---

## ขั้นตอนที่ 7: เปิด Dashboard

```
https://claude-monitor-xxx.workers.dev/
```

Dashboard refresh ทุก 15 วินาที

---

## ทดสอบระบบ

### ทดสอบ Claude Desktop Chat

1. เปิด Claude Desktop → Chat tab → ส่ง prompt
2. ดู console: `[claude-desktop] ...`
3. ดู Dashboard → ควรเห็น entry ใหม่ tag `claude-desktop`

### ทดสอบ Cowork

1. Claude Desktop → Cowork tab → ส่ง prompt
2. ดู console: `[claude-api] claude-desktop-cowork | ...`
3. Dashboard → tag `claude-desktop-cowork`

> ถ้าไม่เห็น log ของ Cowork: เกือบแน่นอนว่ายังไม่ได้รัน `install-claude-proxy.ps1` หรือยังไม่ได้ปิด-เปิด Claude Desktop ใหม่หลังรัน

### ทดสอบ Claude Code CLI

```powershell
# เปิด PowerShell หน้าต่างใหม่ (เพื่อ inherit env vars)
claude
# พิมพ์ prompt → /exit
```

ดู console: `[claude-api] claude-code-cli | ...`

### ทดสอบ Claude Code VSCode

```powershell
# ปิด VSCode ที่เปิดอยู่หมด
code .
# ใช้ Claude Code extension ส่ง prompt
```

ดู console: `[claude-api] claude-code-vscode | ...`

### ทดสอบ Code tab ใน Claude Desktop

1. Claude Desktop → Code tab → ส่ง prompt
2. ดู console: `[claude-api] claude-desktop-code | ...`

---

## แก้ปัญหาที่พบบ่อย

### Cowork ไม่ขึ้น log

**สาเหตุ:** Cowork worker subprocess bypass system proxy

**วิธีแก้:**
1. รัน `install-claude-proxy.ps1` (ตั้ง persistent env vars)
2. ปิด Claude Desktop จาก system tray (Quit)
3. เปิด Claude Desktop ใหม่
4. ลอง Cowork

### Claude Code CLI/VSCode ไม่ขึ้น log

**สาเหตุ:** terminal/VSCode session เก่ายังใช้ env เดิม

**วิธีแก้:**
- เปิด terminal ใหม่ (เพื่อ inherit user env vars)
- หรือเปิด VSCode จาก terminal ใหม่: `code .`
- ตรวจ env: `$env:HTTPS_PROXY` ควรไม่ว่าง

### Cert/TLS error

**สาเหตุ:** CA cert ไม่ถูก trust

**วิธีแก้:**
1. ตรวจว่า cert ติดแล้ว: `Get-ChildItem Cert:\CurrentUser\Root\* | ? Subject -like "*mitmproxy*"`
2. ถ้าไม่เห็น → ทำขั้นตอนที่ 4 ใหม่
3. Restart Claude Desktop หลังติด cert

### Worker คืน 401

**สาเหตุ:** API key ใน `config.py` ไม่ตรงกับ Worker

**วิธีแก้:**
```powershell
cd worker
wrangler secret put API_KEY
# พิมพ์ key เดียวกับใน config.py
npm run deploy
```

### Dashboard ว่าง / ไม่มีข้อมูล

**ตรวจ:**
1. Worker health: `curl https://your-worker.workers.dev/health`
2. ดู error ใน mitmproxy console
3. Query D1: `wrangler d1 execute claude-monitor --remote --command "SELECT COUNT(*) FROM api_logs"`
4. ตรวจ email filter ใน addon.py — อาจถูกกรองทิ้ง

### บาง entry ขึ้น `client: api`

**สาเหตุ:** subprocess strip headers — ทำให้ `_detect_client` ไม่รู้จัก

**วิธีแก้ชั่วคราว:** ปล่อยไป (body heuristic ในหลายเคสยังจัดการให้ — เช่น Cowork ผ่าน `mcp__cowork__*`)
**วิธีแก้ถาวร:** เก็บ header ตัวอย่าง แล้วเพิ่มเงื่อนไขใน `_detect_client`

---

## คำสั่งที่มีประโยชน์

### ดู log ในเครื่อง

```powershell
# ดู log ล่าสุด 5 entries
Get-Content "log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl" | Select-Object -Last 5
```

### Query D1

```powershell
# ค่าใช้จ่ายรวม
wrangler d1 execute claude-monitor --remote --command "SELECT SUM(cost_usd) FROM api_logs"

# สรุป client breakdown
wrangler d1 execute claude-monitor --remote --command "SELECT client, COUNT(*) c, SUM(cost_usd) cost FROM api_logs GROUP BY client ORDER BY c DESC"

# 10 call ล่าสุด
wrangler d1 execute claude-monitor --remote --command "SELECT ts, client, model, total_tokens, cost_usd FROM api_logs ORDER BY ts DESC LIMIT 10"
```

### ลบ log เก่า

```powershell
wrangler d1 execute claude-monitor --remote --command "DELETE FROM api_logs WHERE ts < (strftime('%s', 'now', '-30 days') * 1000)"
```

### Worker logs แบบ real-time

```powershell
wrangler tail
```

### ดู discovery files

```powershell
# Hosts ที่เจอใหม่ (ใช้ค้น endpoint ที่ยังไม่ดักได้)
Get-Content log\claude_connections.jsonl

# POST endpoints ที่ยังไม่มี matcher
Get-Content log\claude_desktop_discovery.jsonl

# WS frames ที่ยังไม่รู้จัก
Get-Content log\claude_bridge_discovery.jsonl
```

---

## โครงสร้างไฟล์

```
claude-monitor/
├── proxy/
│   ├── addon.py                      # mitmproxy addon หลัก
│   ├── config.py                     # ค่าตั้งต้น (สร้างเอง)
│   ├── config.example.py             # template
│   ├── start.ps1                     # เริ่ม proxy + addon
│   ├── enable-proxy.ps1              # ตั้ง env เฉพาะ session ปัจจุบัน
│   ├── disable-proxy.ps1             # คืน env ของ session
│   ├── install-claude-proxy.ps1      # ตั้ง persistent env vars (สำหรับ Cowork/Desktop)
│   └── uninstall-claude-proxy.ps1    # ล้าง persistent env vars
├── worker/
│   ├── src/index.ts                  # Worker + Dashboard (HTML)
│   ├── wrangler.toml
│   └── package.json
├── log/                              # JSONL logs (auto-created)
├── README.md                         # ภาพรวมระบบ
├── SETUP.md                          # คู่มือนี้
└── DEVELOPER.md                      # คู่มือนักพัฒนา
```
