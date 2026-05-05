# Claude Monitor 🔷

ระบบ monitoring สำหรับจับและติดตามการใช้งาน Claude API จากทุก client (Claude Desktop, Claude.ai web, Cowork, Claude Code CLI/VSCode/Desktop, API SDK) สร้างด้วย mitmproxy + Cloudflare Workers + D1

## ทำอะไรได้บ้าง

- **บันทึก log แบบ real-time** — ดักทุก prompt/response ที่ส่งไปหา Claude
- **คำนวณค่าใช้จ่าย** — ประเมินราคา USD จาก token usage แต่ละครั้ง (รวม cache read/write)
- **แยกประเภท client** — รู้ว่ามาจาก Cowork, Code, Chat, CLI, VSCode หรือ API
- **ตรวจ email อัตโนมัติ** — sniff `current_account` ของ claude.ai เพื่อ tag ผู้ใช้
- **กรอง email ได้** — เปิด/ปิดด้วย boolean ตั้ง substring ที่ต้องตรงเพื่อบันทึก
- **Dashboard บนเว็บ** — สรุปยอด calls / cost / token แบบ real-time
- **Local backup** — เก็บ JSONL ในเครื่องทุก call (เผื่อ Worker ล่ม)

## ผลิตภัณฑ์ Claude ที่ครอบคลุม

| Source | ทาง | Client tag |
|---|---|---|
| Claude Code CLI (API key) | `api.anthropic.com/v1/messages` | `claude-code-cli` |
| Claude Code CLI (OAuth) | `bridge.claudeusercontent.com` WebSocket | `claude-code-cli` |
| Claude Code VSCode | `api.anthropic.com/v1/messages` | `claude-code-vscode` |
| Claude Desktop chat | `claude.ai/.../chat_conversations/.../completion` | `claude-desktop` |
| Claude.ai web chat | เหมือน Desktop chat | `claude-desktop` |
| **Cowork** (Desktop) | `api.anthropic.com/v1/messages?beta=true` | `claude-desktop-cowork` |
| **Code tab** (Desktop) | `api.anthropic.com/v1/messages?beta=true` | `claude-desktop-code` |
| Claude API SDK ใดก็ตาม | `api.anthropic.com/v1/messages` | `api` |
| Chrome Extension via bridge | `bridge.claudeusercontent.com` WS | `browser-extension` |

## สถาปัตยกรรมระบบ

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                    │
│  Claude clients (Desktop, Cowork, Code, CLI, VSCode, API)        │
│         │                                                          │
│         ▼  HTTPS_PROXY=127.0.0.1:8080                            │
│  ┌──────────────────────────────────────┐                        │
│  │  mitmproxy + addon.py                │                        │
│  │                                       │                        │
│  │  • ClaudeAccountSniffer  (อ่าน email)│                        │
│  │  • ClaudeAPIMonitor                  │                        │
│  │  • ClaudeDesktopMonitor              │                        │
│  │  • ClaudeBridgeMonitor               │                        │
│  │  • ClaudeConnectionLogger (SNI)      │                        │
│  │  • Discovery addons (debug)          │                        │
│  │                                       │                        │
│  │  → ตรวจ client + Cowork/Code/Cowork  │                        │
│  │  → ดึง prompt (ข้าม system-reminder) │                        │
│  │  → อ่าน token + คำนวณราคา           │                        │
│  │  → กรอง email (optional)             │                        │
│  └────────┬─────────────────────────────┘                        │
│           │                                                        │
│       ┌───┴────────────────────────────┐                         │
│       ▼                                ▼                         │
│   JSONL ในเครื่อง            Cloudflare Worker                  │
│   (log/claude_*.jsonl)       (POST /log)                        │
│                                    │                             │
│                                    ▼                             │
│                            Cloudflare D1                         │
│                                    │                             │
│                                    ▼                             │
│                            Dashboard (HTML)                      │
└──────────────────────────────────────────────────────────────────┘
```

## ส่วนประกอบ

### 1. mitmproxy Addon — `proxy/addon.py`

**Monitor classes (เก็บข้อมูล):**

| Class | หน้าที่ |
|-------|---------|
| `ClaudeAccountSniffer` | อ่าน email จาก `claude.ai/api/auth/current_account` (ทำงานก่อน — เพื่อให้ email พร้อมเวลา log) |
| `ClaudeAPIMonitor` | ดัก `api.anthropic.com/v1/messages` (รวม `?beta=true` ของ Cowork/Code) |
| `ClaudeDesktopMonitor` | ดัก `claude.ai/.../chat_conversations/.../completion` (Chat ปกติ) |
| `ClaudeBridgeMonitor` | ดัก `bridge.claudeusercontent.com` WebSocket (Claude Code OAuth, Cowork chrome agent) |

**Discovery classes (debug):**

| Class | หน้าที่ |
|-------|---------|
| `ClaudeConnectionLogger` | log SNI ของทุก TLS connection (รวม passthrough) → `log/claude_connections.jsonl` |
| `ClaudeDesktopDiscovery` | log POST ที่ยังไม่มี matcher → `log/claude_desktop_discovery.jsonl` |
| `ClaudeBridgeDiscovery` | log WS frames ที่ยังไม่รู้จัก → `log/claude_bridge_discovery.jsonl` |

**Helper functions:**

| Function | หน้าที่ |
|---|---|
| `_detect_client(headers)` | ตรวจ client จาก UA + `anthropic-client-name` + `x-app` + `x-client-context` |
| `_looks_like_cowork(req)` | True ถ้า body มี `mcp__cowork__*` หรือ metadata มีคำว่า cowork |
| `_looks_like_code(req)` | True ถ้า body มี Bash/Read/Write/Edit/... โดยไม่มี cowork |
| `_extract_prompt_api(messages)` | ดึง prompt user จริง (ข้าม `<system-reminder>` blocks) |
| `_extract_prompt_desktop(req)` | ดึง prompt จาก request body หลายฟอร์แมตของ claude.ai |
| `_parse_sse_api(text)` | แปลง SSE → text + token counts |
| `_parse_sse_desktop(text)` | แปลง SSE ของ claude.ai (รองรับ format เก่า/ใหม่) |
| `_calc_cost(...)` | คำนวณ USD จาก model + tokens |
| `_should_log(email)` | True ถ้าผ่าน email filter |
| `_send_log(payload)` | ส่ง POST ไป Worker (bypass system proxy ป้องกัน loopback) |
| `_write_local(payload)` | เขียน JSONL วันนั้น |

**Email filter (option):**

```python
EMAIL_FILTER_ENABLED   = True       # toggle on/off
EMAIL_FILTER_SUBSTRING = "@softdebut"  # case-insensitive substring match
```

เมื่อเปิด — เฉพาะ call ที่ `account_email` มี substring นี้ถึงจะถูกบันทึก/ส่ง

**Pricing (USD / 1M tokens):**

| Model tier | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| Opus | $15 | $75 | $1.50 | $18.75 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $0.80 | $4 | $0.08 | $1.00 |

### 2. Config — `proxy/config.py`

```python
WORKER_URL = "https://your-worker.workers.dev"
API_KEY    = "your-secret"
PROXY_PORT = 8080
```

### 3. Cloudflare Worker — `worker/src/index.ts`

| Endpoint | Method | หน้าที่ |
|---|---|---|
| `/log` | POST | รับ log (ตรวจ `X-Api-Key` ก่อน) |
| `/health` | GET | health check |
| `/` | GET | Dashboard HTML |

**D1 schema:**

```sql
CREATE TABLE api_logs (
  id                    TEXT PRIMARY KEY,
  ts                    INTEGER,       -- ms epoch
  client                TEXT,          -- claude-desktop-cowork, claude-code-cli, ฯลฯ
  account_email         TEXT,
  machine_name          TEXT,
  model                 TEXT,
  prompt                TEXT,
  prompt_chars          INTEGER,
  response_chars        INTEGER,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens     INTEGER,
  total_tokens          INTEGER,
  cost_usd              REAL
);
```

**Dashboard sections:**

- KPI cards (calls / total tokens / cost รวม)
- By Model / By Client / By Account / By Machine
- Recent 100 calls พร้อม prompt preview

### 4. Local logs — `log/`

```
log/
├── claude_2026-05-06.jsonl              # log รายวัน 1 บรรทัด = 1 call
├── claude_connections.jsonl             # SNI ของทุก connection (debug)
├── claude_desktop_discovery.jsonl       # POST ที่ยังไม่มี matcher
└── claude_bridge_discovery.jsonl        # WS frames ที่ยังไม่รู้จัก
```

## ข้อมูลในแต่ละ entry

```json
{
  "id": "uuid",
  "ts": 1777993204233,
  "client": "claude-desktop-cowork",
  "account_email": "user@softdebut.com",
  "machine_name": "MY-PC",
  "model": "claude-sonnet-4-6",
  "prompt": "ข้อความที่ผู้ใช้พิมพ์จริง",
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

## วิธีตรวจจับ Client

ตรวจตามลำดับ:

1. **Headers** — `_detect_client()` อ่าน UA / anthropic-client-name / x-app / x-client-context
   - `claude-code` + `electron` → `claude-desktop-code`
   - `claude-code` + `vscode` → `claude-code-vscode`
   - `claude-code` เพียวๆ → `claude-code-cli`
   - `vscode` → `claude-code-vscode`
   - `electron` หรือ `anthropic` ใน UA → `claude-desktop`
   - อื่นๆ → `api`

2. **Body override** (ใน `ClaudeAPIMonitor`)
   - ถ้า body มี `mcp__cowork__*` → `claude-desktop-cowork`
   - ถ้า body มี Code tools (Bash/Read/Write/...) AND header detect ไม่ได้ → `claude-code-cli` (fallback)

## วิธีตรวจจับ Email

`ClaudeAccountSniffer` อ่าน response ของ endpoint **whitelist เท่านั้น** (เพื่อไม่ปนกับ org member list / support emails):

- `/api/auth/current_account`
- `/api/account`
- `/api/bootstrap/...` และ `/edge-api/bootstrap/...`

## ข้อจำกัดที่รู้

- **Mobile apps** → คนละเครื่อง ต้อง MITM ที่ network layer (router)
- **HTTP/3 (QUIC)** → mitmproxy ดักได้แค่ TCP — ปัจจุบันไม่ปัญหา แต่ระวังในอนาคต
- **Subprocess ของ Cowork/Code** → bypass system proxy โดย default — แก้โดยใช้ `install-claude-proxy.ps1` ตั้ง persistent user env vars
- **Desktop Code subprocess strip header** → อาจถูก tag ปนกับ `claude-code-cli` แทน `claude-desktop-code`

---

ดูคู่มือติดตั้ง: [SETUP.md](SETUP.md)
ดูคู่มือนักพัฒนา: [DEVELOPER.md](DEVELOPER.md)

**สถานะ:** ✅ ใช้งานได้กับทุก channel หลักของ Claude บน Windows desktop / CLI / VSCode / browser-with-proxy
