# คู่มือติดตั้งและใช้งาน 🚀

## สิ่งที่ต้องมีก่อน

- **Python 3.9+** พร้อม pip
- **mitmproxy 9.0+** (`pip install mitmproxy`)
- **Node.js + npm** (สำหรับ deploy Worker)
- **Cloudflare Account** ที่เปิดใช้ Workers + D1
- **Wrangler CLI** (`npm i -g wrangler` หรือใช้ผ่าน `npx`)
- **Logto tenant** (OIDC) สำหรับ login เข้า dashboard

---

## ขั้นตอนที่ 1: ตั้งค่า Cloudflare Worker

### 1a. สร้าง D1 Database

```powershell
cd worker
npm install
wrangler d1 create prompt-logger
```

จะได้ `database_id` เช่น `e2621e12-...` — จดไว้

### 1b. แก้ไข `worker/wrangler.jsonc`

```jsonc
{
  "name": "claude-monitor-hooks",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "account_id": "<YOUR_CLOUDFLARE_ACCOUNT_ID>",
  "observability": { "enabled": true },
  "d1_databases": [
    { "binding": "DB", "database_name": "prompt-logger", "database_id": "<YOUR_DATABASE_ID>" }
  ],
  "vars": {
    "LOGTO_ENDPOINT": "https://<your-logto-tenant>",
    "LOGTO_APP_ID": "<logto-app-id>",
    "LOGTO_REDIRECT_URI": "https://claude-monitor-hooks.<name>.workers.dev",
    "LOGTO_POST_LOGOUT_REDIRECT_URI": "https://claude-monitor-hooks.<name>.workers.dev"
  },
  "rules": [
    { "type": "Text", "globs": ["**/*.html", "**/*.css", "**/*.client.js"], "fallthrough": true }
  ]
}
```

### 1c. สร้างตาราง (schema + migrations)

```powershell
# init ตารางหลัก (api_logs + auth tables) — มี script ใน package.json
npm run db:init          # = wrangler d1 execute prompt-logger --remote --file=schema.sql

# apply migrations ตามลำดับจนถึงตัวล่าสุด (0011)
wrangler d1 execute prompt-logger --remote --file=migrations/0001_add_account_email.sql
# ... 0002 ... 0011 (ดูไฟล์ใน worker/migrations/)
npm run db:migrate-logto # = migrations/0003_logto.sql (เปลี่ยน auth เป็น Logto)
```

> ตาราง `api_logs` ปัจจุบันมี 23 คอลัมน์ (รวม `client_ip` สำหรับ audit + device info) และมีตาราง `email_identity` (ทะเบียนตัวตน canonical) + `sessions`/`oauth_state` (auth) ดูทั้งหมดใน [worker/schema.sql](worker/schema.sql) และ [worker/migrations/](worker/migrations/)

### 1d. ตั้ง Ingest API Key (secret)

```powershell
wrangler secret put API_KEY
# พิมพ์ key ที่ต้องการ เช่น MySecretKey123 — ต้องตรงกับ proxy/config.py
```

### 1e. ตั้งค่า Logto

ใน Logto console สร้าง **Traditional Web App** แล้วตั้ง redirect URI = `https://claude-monitor-hooks.<name>.workers.dev` (ตรงกับ `LOGTO_REDIRECT_URI`) — เอา App ID มาใส่ใน `wrangler.jsonc`

### 1f. Deploy

```powershell
npm run deploy
```

ได้ URL เช่น `https://claude-monitor-hooks.<name>.workers.dev`

---

## ขั้นตอนที่ 2: ตั้งค่า Proxy Addon

### 2a. คัดลอก config

```powershell
cd proxy
Copy-Item config.example.py config.py
```

### 2b. แก้ไข `proxy/config.py`

```python
WORKER_URL = "https://claude-monitor-hooks.<name>.workers.dev"
API_KEY    = "MySecretKey123"   # ต้องตรงกับ wrangler secret put API_KEY (1d)
PROXY_PORT = 8080

EMAIL_FILTER_ENABLED   = True          # ค่าเริ่มต้น ON — log เฉพาะที่ตรง substring
EMAIL_FILTER_SUBSTRING = "@softdebut"  # เปลี่ยนเป็นโดเมนองค์กรของคุณ / False เพื่อ log ทั้งหมด
```

> `config.py` อยู่ใน `.gitignore` — อย่า commit

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
proxy\install-cert.ps1
# หรือทำเอง:
Import-Certificate -FilePath "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem" `
  -CertStoreLocation Cert:\CurrentUser\Root
```

### macOS

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem
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

ตั้งให้ครบ 2 อย่าง:
1. **`~/.claude/settings.json`** → Claude Code CLI / VSCode ใช้
2. **Persistent user env vars** (HTTPS_PROXY, NODE_EXTRA_CA_CERTS, ฯลฯ) → **Cowork worker subprocess** จะ inherit ทันทีที่เปิด Claude Desktop

> ⚠️ ปิด Claude Desktop ให้สิ้น (system tray → Quit) แล้วเปิดใหม่ — ไม่งั้น Cowork จะ bypass proxy
> รายละเอียด scripts แต่ละตัว: [SCRIPTS.md](SCRIPTS.md)

### macOS / Linux

ตั้งใน `~/.bashrc` / `~/.zshrc`:

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

---

## ขั้นตอนที่ 6: เปิด Claude Monitor

```powershell
cd proxy
.\start.ps1
```

`start.ps1` รัน `mitmdump -s addon.py --listen-port 8080 -q --allow-hosts "(anthropic\.com|claude\.ai|claudeusercontent\.com)"`

**ผลลัพธ์ที่ควรเห็นใน console:**

```
[claude-monitor] email filter ON — only logging accounts containing '@softdebut'
[claude-conn] SNI seen: claude.ai
[claude-account] ✓ detected email: user@softdebut.com (from /api/auth/current_account)
[claude-api] claude-desktop-cowork | claude-sonnet-4-6 | in=3 out=23 | $0.09204
[claude-desktop] claude-sonnet-4-6 | prompt=145ch | in=1567 out=789 | $0.00234
```

---

## ขั้นตอนที่ 7: เปิด Dashboard

```
https://claude-monitor-hooks.<name>.workers.dev/
```

ครั้งแรกจะ redirect ไป Logto login เมื่อ login แล้วจะเข้าหน้า Dashboard หน้าอื่นๆ ที่ใช้ได้:

| หน้า | บทบาท |
|---|---|
| `/` Dashboard | KPI cards + recent calls |
| `/logs` | ตาราง log แบบ full-field + filter + pagination |
| `/analytics` | กราฟ trend + Export PDF |
| `/accounts`, `/account` | สรุป/รายละเอียดราย account |
| `/new-identity` | ทะเบียนตัวตน canonical ต่อคน (keyed ด้วย email) |
| `/identity` | snapshot ประวัติ IP↔email (frozen) |
| `/insights`, `/reports`, `/monitoring` | วิเคราะห์/รายงาน/สถานะ |
| `/settings` | rotate ingest key + notifications (admin) |

---

## ทดสอบระบบ

| Client | วิธี | tag ที่ควรเห็น |
|---|---|---|
| Claude Desktop Chat | Chat tab → ส่ง prompt | `claude-desktop` |
| Cowork | Cowork tab → ส่ง prompt | `claude-desktop-cowork` |
| Code tab | Code tab → ส่ง prompt | `claude-desktop-code` |
| Claude Code CLI | PowerShell ใหม่ → `claude` | `claude-code-cli` |
| Claude Code VSCode | `code .` จาก terminal ใหม่ | `claude-code-vscode` |

> ถ้าไม่เห็น log ของ Cowork: เกือบแน่นอนว่ายังไม่ได้รัน `install-claude-proxy.ps1` หรือยังไม่ได้ปิด-เปิด Claude Desktop ใหม่

---

## แก้ปัญหาที่พบบ่อย

### Cowork ไม่ขึ้น log
Cowork worker subprocess bypass system proxy → รัน `install-claude-proxy.ps1` แล้ว Quit Claude Desktop จาก system tray แล้วเปิดใหม่

### Claude Code CLI/VSCode ไม่ขึ้น log
session เก่ายังใช้ env เดิม → เปิด terminal ใหม่ / `code .` จาก terminal ใหม่ · ตรวจ `$env:HTTPS_PROXY` ไม่ว่าง

### Cert/TLS error
`Get-ChildItem Cert:\CurrentUser\Root\* | ? Subject -like "*mitmproxy*"` — ถ้าไม่เห็นให้ทำขั้นตอนที่ 4 ใหม่

### Worker คืน 401 (จาก proxy)
`API_KEY` ใน `config.py` ไม่ตรงกับ secret → `wrangler secret put API_KEY` แล้ว `npm run deploy`

### Dashboard ว่าง / ไม่มีข้อมูล
1. Worker health: `curl https://claude-monitor-hooks.<name>.workers.dev/health`
2. Query D1: `wrangler d1 execute prompt-logger --remote --command "SELECT COUNT(*) FROM api_logs"`
3. ตรวจ email filter ใน `config.py` — อาจถูกกรองทิ้ง

### Login วน / เข้าไม่ได้
ตรวจ `LOGTO_*` ใน `wrangler.jsonc` + redirect URI ใน Logto ให้ตรงกับ URL ของ Worker

---

## คำสั่งที่มีประโยชน์

```powershell
# log ในเครื่องวันนี้
Get-Content "log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl" | Select-Object -Last 5

# Query D1
wrangler d1 execute prompt-logger --remote --command "SELECT SUM(cost_usd) FROM api_logs"
wrangler d1 execute prompt-logger --remote --command "SELECT client, COUNT(*) c, SUM(cost_usd) cost FROM api_logs GROUP BY client ORDER BY c DESC"

# ลบ log เก่า
wrangler d1 execute prompt-logger --remote --command "DELETE FROM api_logs WHERE ts < (strftime('%s','now','-30 days') * 1000)"

# Worker logs real-time
wrangler tail
```

---

## โครงสร้างไฟล์

```
claude-monitor/
├── proxy/                  # mitmproxy addon + scripts (ดู SCRIPTS.md)
├── worker/                 # Cloudflare Worker (modular) + schema + migrations
├── log/                    # JSONL logs (auto-created)
├── README.md               # ภาพรวมระบบ
├── SETUP.md                # คู่มือนี้
├── DEVELOPER.md            # คู่มือนักพัฒนา
└── UNINSTALL.md            # คู่มือถอนการติดตั้ง
```
