# Claude Monitor

ระบบ monitoring สำหรับจับและติดตามการใช้งาน Claude จากทุก client บนเครื่อง Windows สร้างด้วย **mitmproxy + Cloudflare Workers + D1**

## ทำอะไรได้บ้าง

- บันทึก prompt / response / token usage แบบ real-time จากทุก client
- คำนวณค่าใช้จ่าย USD จาก token usage (รวม cache read/write)
- แยกประเภท client อัตโนมัติ (Claude Code CLI, VSCode, Desktop, Cowork, API SDK)
- ตรวจจับ email ของผู้ใช้อัตโนมัติจาก claude.ai session
- กรอง log ตาม email (เปิด/ปิดได้)
- Dashboard บนเว็บ (Cloudflare Worker) สรุป calls / cost / token
- Local backup เป็น JSONL ทุกวัน (เผื่อ Worker ล่ม)

## Clients ที่รองรับ

| Client | Protocol | Tag |
|---|---|---|
| Claude Code CLI (API key) | REST `api.anthropic.com` | `claude-code-cli` |
| Claude Code CLI (OAuth) | WebSocket `bridge.claudeusercontent.com` | `claude-code-cli` |
| Claude Code VSCode | REST `api.anthropic.com` | `claude-code-vscode` |
| Claude Desktop (chat) | SSE `claude.ai/.../completion` | `claude-desktop` |
| Claude.ai web | SSE `claude.ai/.../completion` | `claude-desktop` |
| Cowork (Desktop) | REST `api.anthropic.com?beta=true` | `claude-desktop-cowork` |
| Code tab (Desktop) | REST `api.anthropic.com?beta=true` | `claude-desktop-code` |
| API SDK | REST `api.anthropic.com` | `api` |
| Chrome Extension via bridge | WebSocket `bridge.claudeusercontent.com` | `browser-extension` |

## สถาปัตยกรรม

```
Claude clients (Desktop / Code / CLI / VSCode / API)
        │
        ▼  HTTPS_PROXY=127.0.0.1:8080
┌─────────────────────────────────────────┐
│  mitmproxy + proxy/addon.py             │
│                                         │
│  ClaudeAccountSniffer   — อ่าน email    │
│  ClaudeAPIMonitor       — REST API      │
│  ClaudeDesktopMonitor   — claude.ai SSE │
│  ClaudeBridgeMonitor    — WebSocket     │
│  ClaudeMCPMonitor       — MCP proxy     │
└────────┬────────────────────────────────┘
         │
    ┌────┴──────────────────────┐
    ▼                           ▼
log/claude_YYYY-MM-DD.jsonl    Cloudflare Worker POST /log
(local backup)                          │
                                        ▼
                                 Cloudflare D1 (SQL)
                                        │
                                        ▼
                                 Dashboard (GET /)
```

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.10+ |
| mitmproxy | 10.0+ |
| Node.js | 18+ |
| Wrangler CLI | 3+ |
| Cloudflare account | (free tier ได้) |

## การติดตั้ง

### 1. Clone repo และติดตั้ง dependencies

```bash
git clone <repo-url>
cd claude-monitor
pip install -r proxy/requirements.txt
```

### 2. Deploy Cloudflare Worker

```bash
cd worker
npm install
npm run deploy
```

Worker URL จะออกมาเป็น `https://claude-monitor-hooks.<yourname>.workers.dev`

### 3. สร้าง D1 database

```bash
# สร้าง database ใน Cloudflare
wrangler d1 create prompt-logger

# อัปเดต database_id ใน worker/wrangler.jsonc แล้วรัน schema
npm run db:init
```

### 4. ตั้ง API key บน Worker

```bash
wrangler secret put API_KEY
# พิมพ์ key ที่ต้องการ เช่น  my-secret-key-123
```

### 5. สร้าง config ของ proxy

```bash
cp proxy/config.example.py proxy/config.py
```

แก้ไข `proxy/config.py`:

```python
WORKER_URL = "https://claude-monitor-hooks.<yourname>.workers.dev"
API_KEY    = "my-secret-key-123"   # ตรงกับที่ตั้งใน step 4
PROXY_PORT = 8080
```

### 6. ติดตั้ง CA cert (ครั้งแรกครั้งเดียว)

```powershell
# รัน mitmproxy ครั้งแรกเพื่อ generate cert
.\proxy\start.ps1
# Ctrl+C หลังเห็น "Proxy server listening"

# จากนั้น install cert (ต้องเป็น Administrator)
.\proxy\install-cert.ps1
```

### 7. เปิดใช้งาน proxy

```powershell
# ตั้ง system proxy + Claude Code env vars (persistent)
.\proxy\enable-proxy.ps1

# Restart Claude Desktop / VSCode หลังรันสคริปต์นี้
```

### 8. เริ่ม monitor

```powershell
.\proxy\start.ps1
```

เปิด Dashboard ได้ที่ `https://claude-monitor-hooks.<yourname>.workers.dev`

---

## Email Filter

แก้ใน `proxy/config.py` (หรือ addon.py โดยตรง):

```python
EMAIL_FILTER_ENABLED   = True          # True = กรอง, False = log ทุก account
EMAIL_FILTER_SUBSTRING = "@yourcompany" # case-insensitive substring match
```

เมื่อเปิด — เฉพาะ call ที่ email ผู้ใช้มี substring นี้จะถูกบันทึก

---

## โครงสร้างไฟล์

```
claude-monitor/
├── proxy/
│   ├── addon.py            # mitmproxy addon หลัก
│   ├── config.example.py   # template config
│   ├── config.py           # config จริง (gitignored)
│   ├── requirements.txt
│   ├── start.ps1           # เริ่ม proxy
│   ├── enable-proxy.ps1    # เปิด system proxy
│   ├── disable-proxy.ps1   # ปิด system proxy
│   └── install-cert.ps1    # ติดตั้ง CA cert
├── worker/
│   ├── src/index.ts        # Cloudflare Worker
│   ├── schema.sql          # D1 schema
│   └── wrangler.jsonc
└── log/
    ├── claude_YYYY-MM-DD.jsonl       # log รายวัน
    ├── claude_connections.jsonl       # SNI debug
    ├── claude_desktop_discovery.jsonl # endpoint debug
    └── claude_bridge_discovery.jsonl  # WebSocket debug
```

---

## Log Entry Format

```json
{
  "id": "uuid",
  "ts": 1777993204233,
  "client": "claude-desktop-cowork",
  "account_email": "user@company.com",
  "machine_name": "MY-PC",
  "model": "claude-sonnet-4-6",
  "prompt": "ข้อความที่ผู้ใช้พิมพ์",
  "prompt_chars": 17,
  "response_chars": 59,
  "input_tokens": 3,
  "output_tokens": 23,
  "cache_creation_tokens": 22784,
  "cache_read_tokens": 20830,
  "total_tokens": 43640,
  "cost_usd": 0.092043
}
```

## Pricing (USD / 1M tokens)

| Model | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| Opus | $15 | $75 | $1.50 | $18.75 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $0.80 | $4 | $0.08 | $1.00 |

---

## Worker API

| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/log` | POST | รับ log entry (ต้องส่ง `X-Api-Key` header) |
| `/health` | GET | health check |
| `/` | GET | Dashboard HTML |

---

## ข้อจำกัดที่รู้

- **Mobile apps** — ต้องทำ MITM ที่ระดับ router เพราะคนละเครื่อง
- **HTTP/3 (QUIC)** — mitmproxy ดักได้แค่ TCP; ตอนนี้ไม่มีปัญหา แต่อาจเปลี่ยนได้ในอนาคต
- **Desktop Code subprocess** — อาจ strip header ทำให้ tag เป็น `claude-code-cli` แทน `claude-desktop-code`

## ปิด proxy

```powershell
# หยุด mitmproxy: Ctrl+C ใน terminal ที่รัน start.ps1

# ถอด system proxy
.\proxy\disable-proxy.ps1
```
