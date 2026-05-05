# Claude Monitor 🔷

ระบบ monitoring สำหรับจับและติดตามการใช้งาน Claude API จากทุก client (Claude Desktop, Claude Code, API) สร้างด้วย mitmproxy และ Cloudflare Workers + D1 database

## ทำอะไรได้บ้าง

- **บันทึก log แบบ real-time** — จับทุก request/response ที่ส่งไปหา Claude API
- **คำนวณค่าใช้จ่าย** — ประเมินราคา USD จาก token usage แต่ละครั้ง
- **วิเคราะห์ token** — แยก input, output, cache read/write tokens
- **แยกสถิติ** ตาม model, client, เครื่อง, และบัญชีผู้ใช้
- **Dashboard บนเว็บ** — ดูข้อมูลแบบ real-time, refresh ทุก 15 วินาที
- **บันทึก JSONL ในเครื่อง** — สำรองข้อมูลไว้ที่ local ด้วยเสมอ

## สถาปัตยกรรมระบบ

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  Client (Claude Desktop, Claude Code, API)                   │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────────┐                                         │
│  │  mitmproxy      │  ← ดักจับ HTTP traffic ของ Claude      │
│  │   addon.py      │                                         │
│  │                 │                                         │
│  │ • ตรวจ client   │                                         │
│  │ • ดึง prompt    │                                         │
│  │ • อ่าน token    │                                         │
│  │ • คำนวณราคา     │                                         │
│  └────────┬────────┘                                         │
│           │                                                   │
│       ┌───┴────────────────────────────┐                     │
│       │                                │                     │
│       ▼                                ▼                     │
│   JSONL ในเครื่อง            Cloudflare Worker              │
│   (log/claude_*.jsonl)       (POST /log)                    │
│       │                           │                          │
│       │                           ▼                          │
│       │                    ┌─────────────┐                  │
│       │                    │ Cloudflare  │                  │
│       │                    │   D1 DB     │                  │
│       │                    │ (SQLite)    │                  │
│       │                    └─────┬───────┘                  │
│       │                          │                          │
│       │                          ▼                          │
│       └──────────────────> Dashboard                        │
│                            (HTML, Real-time)                │
└─────────────────────────────────────────────────────────────┘
```

## ส่วนประกอบของระบบ

### 1. mitmproxy Addon (`proxy/addon.py`)

หัวใจหลักของระบบ — ทำงานเป็น mitmproxy addon คอยดักจับ traffic

**Classes หลัก:**

| Class | หน้าที่ |
|-------|---------|
| `ClaudeAPIMonitor` | ดักจับ `api.anthropic.com/v1/messages` (Claude Code, API key users) |
| `ClaudeDesktopMonitor` | ดักจับ `claude.ai/.../completion` (Claude Desktop app) |
| `ClaudeAccountSniffer` | อ่าน email ของผู้ใช้จาก claude.ai responses อัตโนมัติ |
| `ClaudeDesktopDiscovery` | Debug — บันทึก POST อื่นๆ ของ claude.ai ที่ยังไม่ได้จัดการ |
| `ClaudeBridgeDiscovery` | Debug — บันทึก WebSocket frames จาก bridge.claudeusercontent.com |

**ฟังก์ชันช่วย:**

| ฟังก์ชัน | หน้าที่ |
|---------|---------|
| `_parse_sse_api()` | แปลง SSE response ของ api.anthropic.com ให้เป็น token counts |
| `_parse_sse_desktop()` | แปลง SSE response ของ claude.ai (รองรับทั้ง format เก่าและใหม่) |
| `_extract_prompt_api()` | ดึง user message สุดท้ายจาก messages array |
| `_extract_prompt_desktop()` | ดึง prompt จาก request body ของ claude.ai |
| `_detect_client()` | ตรวจว่าใช้ client อะไร (จาก HTTP headers) |
| `_calc_cost()` | คำนวณราคา USD จาก model และ token จำนวน |
| `_send_log()` | ส่ง log ไปยัง Worker (async, ไม่บล็อก) |
| `_write_local()` | บันทึกลง JSONL ในเครื่อง |

**ราคา token (USD / 1M tokens):**

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| Opus | $15 | $75 | $1.50 | $18.75 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $0.80 | $4 | $0.08 | $1.00 |

### 2. Config (`proxy/config.py`)

ตั้งค่า URL และ API key สำหรับ addon

```python
WORKER_URL = "https://your-worker.workers.dev"   # Worker endpoint
API_KEY    = "secret-key"                          # ต้องตรงกับ Worker
PROXY_PORT = 8080                                  # port ของ mitmproxy
```

### 3. Cloudflare Worker (`worker/src/index.ts`)

Backend API ที่รับ log และแสดง dashboard

**Endpoints:**

| Path | Method | หน้าที่ |
|------|--------|---------|
| `/log` | POST | รับ log จาก addon (ต้องมี `X-Api-Key` header) |
| `/health` | GET | ตรวจสถานะ Worker |
| `/` | GET | แสดง HTML Dashboard |

**โครงสร้าง D1 Database:**

```sql
CREATE TABLE api_logs (
  id                    TEXT PRIMARY KEY,
  ts                    INTEGER,       -- milliseconds timestamp
  client                TEXT,          -- "claude-code" | "claude-desktop" | "vscode" | "api"
  account_email         TEXT,          -- email ของผู้ใช้ (ถ้าตรวจพบ)
  machine_name          TEXT,          -- ชื่อเครื่อง hostname
  model                 TEXT,          -- เช่น "claude-3.5-sonnet-20241022"
  prompt                TEXT,          -- ข้อความ user message สุดท้าย
  prompt_chars          INTEGER,       -- จำนวนตัวอักษรของ prompt
  response_chars        INTEGER,       -- จำนวนตัวอักษรของ response
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens     INTEGER,
  total_tokens          INTEGER,
  cost_usd              REAL           -- ราคาโดยประมาณ USD
);
```

**หน้า Dashboard:**

- **KPI Cards** — จำนวน API calls, token รวม, ราคารวม
- **By Model** — แยกสถิติตาม model
- **By Account** — แยกตาม email บัญชี
- **By Client** — แยกตาม Claude Desktop / Claude Code / API
- **By Machine** — แยกตาม hostname
- **Recent Calls** — 100 รายการล่าสุด พร้อมดู prompt เต็มได้

### 4. Local JSONL (`log/`)

ไฟล์บันทึก backup ในเครื่อง แยกตามวัน

```
log/
├── claude_2024-12-19.jsonl          # log รายวัน (1 บรรทัด = 1 API call)
├── claude_desktop_discovery.jsonl   # POST อื่นๆ ของ claude.ai (debug)
└── claude_bridge_discovery.jsonl    # WebSocket frames (debug)
```

## ข้อมูลที่บันทึกในแต่ละ call

```json
{
  "id": "uuid",
  "ts": 1734600000000,
  "client": "claude-code",
  "account_email": "user@example.com",
  "machine_name": "MY-PC",
  "model": "claude-3.5-sonnet-20241022",
  "prompt": "ข้อความที่ส่งไปหา Claude",
  "prompt_chars": 120,
  "response_chars": 450,
  "input_tokens": 234,
  "output_tokens": 89,
  "cache_creation_tokens": 0,
  "cache_read_tokens": 150,
  "total_tokens": 473,
  "cost_usd": 0.00123
}
```

## การตรวจจับ Client

addon ดูจาก HTTP headers เพื่อบอกว่าใช้ client ไหน:

```
user-agent: "claude-code"       → "claude-code"
user-agent: "vscode"            → "vscode"
user-agent: "electron"          → "claude-desktop"
(ไม่ตรงกับอะไร)                 → "api"
```

## การตรวจจับ Email

addon จะคอยดู response ของ claude.ai และดึง email ของผู้ใช้จาก endpoint ที่เชื่อถือได้:

- `/api/auth/current_account`
- `/api/account`
- `/api/bootstrap/*` และ `/edge-api/bootstrap/*`

> ผู้ใช้ API key ที่ไม่ได้ login claude.ai จะไม่มี email

---

**สถานะ:** ✅ ใช้งานได้ — monitoring Claude API แบบ real-time
