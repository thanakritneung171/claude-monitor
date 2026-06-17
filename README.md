# Claude Monitor 🔷

ระบบ monitoring สำหรับจับและติดตามการใช้งาน Claude API จากทุก client (Claude Desktop, Claude.ai web, Cowork, Claude Code CLI/VSCode/Desktop, API SDK) สร้างด้วย mitmproxy + Cloudflare Workers + D1

> **SDB AI Insight** = ชื่อผลิตภัณฑ์/dashboard ที่ผู้ใช้เห็น · ชื่อระบบเบื้องหลังในโค้ดคือ *Claude Monitor*

## ทำอะไรได้บ้าง

- **บันทึก log แบบ real-time** — ดักทุก prompt/response ที่ส่งไปหา Claude
- **คำนวณค่าใช้จ่าย** — ประเมินราคา USD จาก token usage แต่ละครั้ง (รวม cache read/write)
- **แยกประเภท client** — รู้ว่ามาจาก Cowork, Code, Chat, CLI, VSCode หรือ API
- **ระบุตัวตนด้วย email (VPN-safe)** — อ่าน email จาก **token ที่ request พกมาเอง** (JWT / account_uuid / session cookie / bridge) ไม่เดาตัวตนจาก IP จึงไม่สับสนแม้ผู้ใช้เปลี่ยน IP ผ่าน VPN
- **กรอง email ได้** — เปิด/ปิดด้วย boolean ตั้ง substring ที่ต้องตรงเพื่อบันทึก (ค่าเริ่มต้น: ON, `@softdebut`)
- **Dashboard บนเว็บ** — หลายหน้า (Dashboard, Logs, Analytics, Accounts, Identity, Insights, Reports ฯลฯ) ป้องกันด้วย Logto OIDC login
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
│  Claude clients (Desktop, Cowork, Code, CLI, VSCode, API)         │
│         │                                                          │
│         ▼  HTTPS_PROXY=127.0.0.1:8080                              │
│  ┌──────────────────────────────────────┐                         │
│  │  mitmproxy + addon.py                 │                         │
│  │                                       │                         │
│  │  • ToolSchemaFixer    (request hook)  │                         │
│  │  • ClaudeAccountSniffer (email/cookie)│                         │
│  │  • ClaudeCodeMetricsMonitor (uuid→mail)│                        │
│  │  • ClaudeAPIMonitor                   │                         │
│  │  • ClaudeDesktopMonitor               │                         │
│  │  • ClaudeBridgeMonitor                │                         │
│  │  • Connection/Discovery (debug)       │                         │
│  │                                       │                         │
│  │  → ตรวจ client + Cowork/Code          │                         │
│  │  → ดึง prompt (ข้าม system-reminder)  │                         │
│  │  → resolve email จาก token ของ request │                        │
│  │  → อ่าน token + คำนวณราคา             │                         │
│  │  → กรอง email (optional)              │                         │
│  └────────┬─────────────────────────────┘                         │
│           │                                                        │
│       ┌───┴────────────────────────────┐                          │
│       ▼                                ▼                           │
│   JSONL ในเครื่อง            Cloudflare Worker                     │
│   (log/claude_*.jsonl)       (POST /log + Logto-gated dashboard)   │
│                                    │                               │
│                                    ▼                               │
│                            Cloudflare D1                           │
│                            (api_logs + email_identity + auth)      │
│                                    │                               │
│                                    ▼                               │
│                            Dashboard (หลายหน้า HTML)               │
└──────────────────────────────────────────────────────────────────┘
```

> หลักการกลาง: **"อ่านตัวตนจาก token ที่ request พกมาเอง แทนการเดาตัวตนจาก IP"** — `client_ip` ยังเก็บไว้แต่ใช้เพื่อ **audit เท่านั้น ไม่ใช้ระบุตัวตน**

## ส่วนประกอบ

### 1. mitmproxy Addon — `proxy/addon.py`

**Request hook:**

| Class | หน้าที่ |
|-------|---------|
| `ToolSchemaFixer` | แก้ tool `input_schema` ที่มี `oneOf/allOf/anyOf` ระดับ top-level (Anthropic API ปฏิเสธ) ให้ผ่านได้ → log ลง `log/schema_fixes.jsonl` |

**Monitor / identity classes:**

| Class | หน้าที่ |
|-------|---------|
| `ClaudeAccountSniffer` | อ่าน email จาก claude.ai (whitelist: `current_account` / `account` / `bootstrap`) แล้วผูกกับ session cookie |
| `ClaudeCodeMetricsMonitor` | ดัก `/api/claude_code/metrics` — สร้าง map `account_uuid → email`, `token → email`, เก็บ OS/arch/version + account_id/org_id |
| `ClaudeAPIMonitor` | ดัก `api.anthropic.com/v1/messages` (รวม `?beta=true` ของ Cowork/Code) — ดึง email จาก JWT |
| `ClaudeDesktopMonitor` | ดัก `claude.ai/.../chat_conversations/.../completion` (Chat ปกติ) |
| `ClaudeBridgeMonitor` | ดัก `bridge.claudeusercontent.com` WebSocket (Claude Code OAuth) — ดึง email จาก `connect` handshake |

**Discovery classes (debug):**

| Class | หน้าที่ |
|-------|---------|
| `ClaudeConnectionLogger` | log SNI ของทุก TLS connection → `log/claude_connections.jsonl` |
| `ClaudeDesktopDiscovery` | log POST ที่ยังไม่มี matcher → `log/claude_desktop_discovery.jsonl` |
| `ClaudeBridgeDiscovery` | log WS frames ที่ยังไม่รู้จัก → `log/claude_bridge_discovery.jsonl` |
| `IdentityDebug` | (ชั่วคราว) log การ resolve identity ต่อ request → `log/identity_debug.jsonl` |

> `ClaudeSegmentMonitor` ยังอยู่ในไฟล์แต่ **เลิกใช้แล้ว** (host ของ Segment ไม่มี session cookie จึง correlate ไม่ได้) — `anon_id` กลายเป็น vestigial

**Helper functions ที่สำคัญ:**

| Function | หน้าที่ |
|---|---|
| `current_email(flow)` | resolve email ของ request ด้วยลำดับ 4 ชั้น (JWT → account_uuid → token → session cookie) **โดยไม่ใช้ IP** |
| `_detect_client(headers)` | ตรวจ client จาก UA + `anthropic-client-name` + `x-app` + `x-client-context` |
| `_looks_like_cowork(req)` / `_looks_like_code(req)` | body heuristic เมื่อ header ถูก strip |
| `_extract_prompt_api` / `_extract_prompt_desktop` | ดึง prompt จริง (ข้าม `<system-reminder>` blocks) |
| `_parse_sse_api` / `_parse_sse_desktop` | แปลง SSE → text + token counts |
| `_calc_cost(...)` | คำนวณ USD จาก model + tokens |
| `_should_log(email)` | True ถ้าผ่าน email filter |
| `_persist_identity()` / `_load_identity_seed()` | persist/restore identity map ลง `proxy/identity_cache.json` (จำข้ามการ restart) |
| `_send_log(payload)` / `_write_local(payload)` | ส่ง POST ไป Worker (bypass system proxy) / เขียน JSONL วันนั้น |

**Email filter (config.py / env):**

```python
EMAIL_FILTER_ENABLED   = True          # ค่าเริ่มต้น ON
EMAIL_FILTER_SUBSTRING = "@softdebut"  # case-insensitive substring match
```

เมื่อเปิด — เฉพาะ call ที่ resolve email ได้และมี substring นี้ถึงจะถูกบันทึก/ส่ง (resolve ไม่ได้ = drop)

**Pricing (USD / 1M tokens):**

| Model tier | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| Opus | $15 | $75 | $1.50 | $18.75 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $0.80 | $4 | $0.08 | $1.00 |

### 2. Config — `proxy/config.py`

```python
WORKER_URL = "https://claude-monitor-hooks.<yourname>.workers.dev"
API_KEY    = "your-secret"            # ต้องตรงกับ wrangler secret put API_KEY
PROXY_PORT = 8080
EMAIL_FILTER_ENABLED   = True
EMAIL_FILTER_SUBSTRING = "@softdebut"
```

### 3. Cloudflare Worker — `worker/` (โครงสร้างแบบ modular)

Worker ชื่อ `claude-monitor-hooks` ผูกกับ D1 ชื่อ `prompt-logger` entry คือ `src/index.ts` (route dispatcher) แตก handler/SQL/view ออกเป็นไฟล์ย่อยใน `routes/`, `db/`, `lib/`, `views/`

**Endpoints หลัก:**

| Endpoint | Method | Auth | หน้าที่ |
|---|---|---|---|
| `/log` | POST | `X-Api-Key` | รับ log จาก proxy → INSERT OR IGNORE ลง D1 |
| `/health` | GET | — | health check |
| `/login`, `/logout`, `/api/me`, `/` (`?code=`) | GET | Logto OIDC | auth flow |
| `/` | GET | login | Dashboard (KPI + recent calls) |
| `/logs` | GET | login | ตาราง log แบบ full-field + filter + pagination |
| `/analytics` | GET | login | กราฟ trend + Export PDF |
| `/accounts`, `/account` | GET | login | สรุปต่อ account / รายละเอียดราย account |
| `/new-identity` | GET | login | ทะเบียนตัวตน canonical ต่อคน (keyed ด้วย email) |
| `/identity` | GET | login | snapshot ประวัติ IP↔email แบบ **frozen** (ไม่อัปเดตแล้ว) |
| `/insights`, `/reports`, `/monitoring`, `/data-sources` | GET | login | วิเคราะห์/รายงาน/สถานะ |
| `/export` | GET | login | download CSV/XLSX |
| `/settings`, `/settings/key-rotate`, `/settings/notifications` | GET/POST | login (admin) | ตั้งค่า + rotate ingest key |
| `/clear-data` | GET/POST | login | ล้างข้อมูล |

**Auth:** ทุก dashboard route ป้องกันด้วย **Logto OIDC** (config ใน `wrangler.jsonc` → `LOGTO_*` vars) — `requireUser()` ตรวจ session ก่อนทุกหน้า ยกเว้น `/log`, `/health`, `/login`, callback

**D1 — ตารางหลัก:**

- `api_logs` — 1 แถว = 1 call (23 คอลัมน์ ดูด้านล่าง)
- `email_identity` — ทะเบียนตัวตน canonical keyed ด้วย email (VPN-safe)
- `ip_identity_backup` — snapshot ประวัติ IP↔email แบบ frozen (powers หน้า `/identity`)
- `sessions`, `oauth_state`, `app_settings` — auth + การตั้งค่า

```sql
CREATE TABLE api_logs (
  id, ts, client, account_email, machine_name, model,
  prompt, prompt_chars, response_chars,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
  total_tokens, cost_usd,
  client_ip,                                          -- audit เท่านั้น
  app_version, os_type, os_version, host_arch,        -- device info (จาก metrics)
  terminal, device_id, mac_address
);
```

### 4. Local logs — `log/`

```
log/
├── claude_2026-06-12.jsonl              # log รายวัน 1 บรรทัด = 1 call
├── claude_connections.jsonl             # SNI ของทุก connection (debug)
├── claude_desktop_discovery.jsonl       # POST ที่ยังไม่มี matcher
├── claude_bridge_discovery.jsonl        # WS frames ที่ยังไม่รู้จัก
├── identity_debug.jsonl                 # debug การ resolve identity ต่อ request
└── schema_fixes.jsonl                   # tool ที่ ToolSchemaFixer rewrite
```

## ข้อมูลในแต่ละ entry

```json
{
  "id": "uuid",
  "ts": 1781245574963,
  "client": "claude-code-cli",
  "account_email": "user@softdebut.com",
  "client_ip": "10.27.0.25",
  "machine_name": "10.27.0.25",
  "model": "claude-opus-4-8",
  "prompt": "ข้อความที่ผู้ใช้พิมพ์จริง",
  "prompt_chars": 39,
  "response_chars": 40,
  "input_tokens": 2,
  "output_tokens": 450,
  "cache_creation_tokens": 0,
  "cache_read_tokens": 194244,
  "total_tokens": 194696,
  "cost_usd": 0.325146,
  "app_version": "1.12603.1",
  "os_type": "windows",
  "os_version": "10.0.26200",
  "host_arch": "amd64",
  "terminal": "non-interactive",
  "device_id": "a223de65-...",
  "mac_address": "",
  "account_id": "user_01M2GB8...",
  "org_id": "909caccf-..."
}
```

## วิธีตรวจจับ Client

ตรวจตามลำดับ:

1. **Headers** — `_detect_client()` อ่าน UA / anthropic-client-name / x-app / x-client-context
   - `claude-code` + `electron` (ไม่ใช่ vscode) → `claude-desktop-code`
   - `claude-code` + `vscode` → `claude-code-vscode`
   - `claude-code` เพียวๆ → `claude-code-cli`
   - `vscode` → `claude-code-vscode`
   - `electron` หรือ `anthropic` ใน UA → `claude-desktop`
   - อื่นๆ → `api`

2. **Body override** (ใน `ClaudeAPIMonitor`)
   - body มี `mcp__cowork__*` → `claude-desktop-cowork`
   - body มี Code tools (Bash/Read/Write/...) และ header detect ไม่ได้ → `claude-code-cli` (fallback)

## วิธีระบุ Email (4 ชั้น, ไม่ใช้ IP)

ฟังก์ชัน `current_email(flow)` resolve ตามลำดับ:

1. **JWT บน request เอง** → `_jwt_email()` (subscription token ที่มี `email` claim; `sk-` = ข้าม)
2. **account_uuid ใน metadata** → `_EMAIL_BY_UUID[uuid]` (Claude Code, ใช้ได้แม้เป็น raw sk-key — เติมจาก metrics)
3. **OAuth token → email** → `_EMAIL_BY_TOKEN[token]` (เติมจาก metrics)
4. **session cookie → email** → `_EMAIL_BY_SESSION[hash]` (claude.ai chat — sniff `current_account`)

ถ้าทุกชั้น resolve ไม่ได้ → email ว่าง → ถูก email filter drop (ไม่เดา email จาก IP)

> รายละเอียดเชิงลึก ดู [CONTEXT-PROMPT-LOG-SYSTEM.md](CONTEXT-PROMPT-LOG-SYSTEM.md) และ [proxy/PROXY-GUIDE.md](proxy/PROXY-GUIDE.md)

## ข้อจำกัดที่รู้

- **Mobile apps** → คนละเครื่อง ต้อง MITM ที่ network layer (router)
- **HTTP/3 (QUIC)** → mitmproxy ดักได้แค่ TCP
- **Subprocess ของ Cowork/Code** → bypass system proxy โดย default — แก้โดยใช้ `install-claude-proxy.ps1` ตั้ง persistent user env vars
- **Desktop Code subprocess strip header** → อาจถูก tag ปนกับ `claude-code-cli`

---

ดูคู่มือติดตั้ง: [SETUP.md](SETUP.md) · คู่มือนักพัฒนา: [DEVELOPER.md](DEVELOPER.md)
ฝั่ง proxy: [proxy/PROXY-GUIDE.md](proxy/PROXY-GUIDE.md) · ฝั่ง worker: [worker/WORKER-GUIDE.md](worker/WORKER-GUIDE.md)

**สถานะ:** ✅ ใช้งานได้กับทุก channel หลักของ Claude บน Windows desktop / CLI / VSCode / browser-with-proxy
