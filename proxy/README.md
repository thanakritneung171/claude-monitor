# Proxy — เอกสารโดยละเอียด

โฟลเดอร์นี้คือหัวใจของ claude-monitor: **mitmproxy** + **addon.py** ทำหน้าที่ดักทราฟฟิก HTTPS ของทุก Claude client (Desktop, Cowork, Code CLI/VSCode/Desktop, claude.ai web, API SDK), ตีความ request/response, แล้วเขียน log ทั้งลง JSONL ในเครื่อง และยิง POST ขึ้น Cloudflare Worker

> ภาพรวมระบบทั้งหมด ดูที่ [../README.md](../README.md)
> คู่มือติดตั้งทั้ง stack (Worker + D1 + Proxy) ดูที่ [../SETUP.md](../SETUP.md)
> เอกสารนี้เน้นเฉพาะ **โฟลเดอร์ proxy/**

---

## สารบัญ

1. [สถาปัตยกรรม](#สถาปัตยกรรม)
2. [ไฟล์ในโฟลเดอร์](#ไฟล์ในโฟลเดอร์)
3. [`addon.py` ภายใน](#addonpy-ภายใน)
4. [การติดตั้ง — Quick Start](#การติดตั้ง--quick-start)
5. [การติดตั้ง — แบบละเอียด](#การติดตั้ง--แบบละเอียด)
6. [การใช้งานประจำวัน](#การใช้งานประจำวัน)
7. [ปรับแต่ง](#ปรับแต่ง)
8. [Troubleshooting](#troubleshooting)

---

## สถาปัตยกรรม

```
                    ┌────────────────────────────────────┐
   Claude clients   │  Desktop · Cowork · Code · CLI ·   │
   (HTTPS_PROXY)    │  VSCode · claude.ai web · API SDK  │
                    └─────────────┬──────────────────────┘
                                  │  HTTPS via 127.0.0.1:8080
                                  ▼
                    ┌────────────────────────────────────┐
                    │      mitmdump  --listen-port 8080  │
                    │      --allow-hosts (anthropic.com  │
                    │       |claude.ai|claudeusercontent)│
                    └─────────────┬──────────────────────┘
                                  │ TLS terminate (mitm CA cert)
                                  ▼
                    ┌────────────────────────────────────┐
                    │           addon.py                 │
                    │                                    │
                    │  request hooks ──► ToolSchemaFixer │
                    │                                    │
                    │  response hooks ─► AccountSniffer  │
                    │                  ► APIMonitor      │
                    │                  ► DesktopMonitor  │
                    │                  ► BridgeMonitor   │
                    │                                    │
                    │  discovery (debug):                │
                    │                  ► ConnectionLogger│
                    │                  ► DesktopDiscovery│
                    │                  ► BridgeDiscovery │
                    └─────────┬───────────────────┬──────┘
                              │                   │
                              ▼                   ▼
                ┌──────────────────┐     ┌───────────────────┐
                │  log/*.jsonl     │     │  Cloudflare Worker│
                │  (วันละไฟล์)     │     │  POST /log        │
                └──────────────────┘     └───────────────────┘
                                                  │
                                                  ▼
                                         D1 → Dashboard HTML
```

**Key ideas**

- **Proxy ตัวเดียวรองรับทุก client** เพราะใช้ HTTPS_PROXY เดียวกัน + CA cert ชุดเดียว
- **`--allow-hosts` regex** จะ MITM เฉพาะ subdomain ของ Anthropic / Claude / claudeusercontent ที่เหลือ pass-through ไม่กระทบความเร็วของ traffic อื่น (Slack, GitHub, ฯลฯ)
- **addon.py แตกเป็น class เล็กๆ** แต่ละตัวรับผิดชอบ endpoint เดียว — debug ง่าย และเพิ่มตัวใหม่โดยไม่กระทบของเดิม
- **Local JSONL ก่อน Worker** — call ทุก call ถูก append ลง `log/claude_YYYY-MM-DD.jsonl` ก่อนส่ง Worker เป็น thread แยก (fire-and-forget) ถ้า Worker ล่มจะไม่กระทบ log เครื่อง

---

## ไฟล์ในโฟลเดอร์

| ไฟล์ | หน้าที่ |
|---|---|
| **`addon.py`** | mitmproxy addon หลัก — ดัก/ตีความ/log ทั้งหมดอยู่ที่นี่ |
| `config.py` | ค่าตั้งต้น — `WORKER_URL`, `API_KEY`, `PROXY_PORT` (gitignored) |
| `config.example.py` | template ของ `config.py` — copy แล้วเติม value จริง |
| `requirements.txt` | Python deps (`mitmproxy`) |
| **`start.ps1`** | รัน mitmdump พร้อม `--allow-hosts` regex และ addon.py |
| `install-cert.ps1` | (Run as Admin) ลง mitmproxy CA cert ลง Trusted Root ของ Windows |
| `enable-proxy.ps1` | dot-source แล้วตั้ง `HTTPS_PROXY` / `NODE_EXTRA_CA_CERTS` ให้ **session ปัจจุบัน** เท่านั้น |
| `disable-proxy.ps1` | dot-source แล้วลบ env ของ session |
| `install-proxy-env.ps1` | ตั้ง env vars ให้ **User-level (permanent)** — VSCode/CLI ที่เปิดจาก explorer ก็ inherit |
| `install-claude-proxy.ps1` | one-time setup: เขียน `~/.claude/settings.json` + ตั้ง persistent env vars (สำหรับ Claude Desktop / Cowork worker subprocess) |
| `uninstall-claude-proxy.ps1` | revert ทุกอย่างจาก `install-claude-proxy.ps1` |

---

## `addon.py` ภายใน

`addon.py` ประกอบด้วย 4 ส่วนใหญ่:

### 1. การตั้งค่าและตัวช่วย (top-level)

```python
import config                      # โหลด WORKER_URL, API_KEY
EMAIL_FILTER_ENABLED   = False     # toggle filter
EMAIL_FILTER_SUBSTRING = "@softdebut"
_ACCOUNT = {"email": "", ...}      # cache ที่ AccountSniffer เติม
LOG_DIR  = .../log
```

| Helper | หน้าที่ |
|---|---|
| `_log_path()` | path ของ JSONL วันนี้ — `log/claude_YYYY-MM-DD.jsonl` |
| `_write_local(payload)` | append หนึ่ง JSON line (thread-safe) |
| `_send_log(payload)` | POST ไป Worker (มี opener ที่ bypass system proxy เพื่อกัน loopback) |
| `_calc_cost(model, in, out, cr, cw)` | คำนวณ USD จาก tier (Opus / Sonnet / Haiku) |
| `_should_log(email)` | True ถ้าผ่าน email filter |

### 2. ตัว detector ของ client + Cowork/Code

```python
def _detect_client(headers) -> str:
    # อ่าน user-agent / anthropic-client-name / x-app / x-client-context
    # คืน claude-code-cli / claude-code-vscode / claude-desktop-code /
    # claude-desktop / api
```

ลำดับตรวจ:

1. มี `claude-code` ใน UA/header → branch ของ Claude Code
   - มี `electron` แต่ไม่มี `vscode` → `claude-desktop-code`
   - มี `vscode` → `claude-code-vscode`
   - อย่างอื่น → `claude-code-cli`
2. มี `vscode` → `claude-code-vscode`
3. มี `electron` หรือ `anthropic` ใน UA → `claude-desktop`
4. ไม่ตรงเลย → `api`

**Body override (ใน `ClaudeAPIMonitor.response`):**

```python
if _looks_like_cowork(req, headers):  # body มี mcp__cowork__*
    client = "claude-desktop-cowork"  # ✓ marker ชัด — override ได้เลย
elif _looks_like_code(req) and client == "api":
    client = "claude-code-cli"        # fallback เมื่อ header ถูก strip
```

### 3. Request hook — `ToolSchemaFixer`

```python
class ToolSchemaFixer:
    def request(self, flow):
        # POST /v1/messages เท่านั้น
        # หา tool ใน body.tools[] ที่ input_schema (หรือ custom.input_schema)
        # มี oneOf / allOf / anyOf ที่ root → flatten เป็น
        # {"type": "object", "additionalProperties": True}
        # log รายชื่อ tool ที่แก้ไปลง log/schema_fixes.jsonl
```

**ทำไมต้องมี:** Anthropic API ปฏิเสธ schema ที่มี union ที่ root (`oneOf` / `allOf` / `anyOf`) — บาง MCP connector ของ claude.ai (Notion, Google Drive, ฯลฯ) ส่ง schema แบบนี้มา ทำให้ทั้ง request 400 ทันที hook นี้ rewrite ในชั้น proxy เพื่อให้ผ่าน

**ผลข้างเคียง:** tool ที่ถูก flatten จะสูญเสียข้อมูล validation พารามิเตอร์ — model อาจเรียกด้วย args ที่ MCP server reject แต่ chat ปกติและ tool อื่นๆ ใช้ได้

### 4. Response hooks — Monitor classes

| Class | endpoint ที่ดัก | client tag | output |
|---|---|---|---|
| **`ClaudeAPIMonitor`** | `api.anthropic.com/v1/messages` (รวม `?beta=true`) | `claude-code-cli` / `claude-code-vscode` / `claude-desktop-code` / `claude-desktop-cowork` / `api` | jsonl + worker |
| **`ClaudeDesktopMonitor`** | `claude.ai/api/organizations/.../chat_conversations/.../completion` | `claude-desktop` | jsonl + worker |
| **`ClaudeBridgeMonitor`** | `bridge.claudeusercontent.com` WebSocket | `claude-code-cli` / `claude-code-vscode` / `browser-extension` | jsonl + worker |

แต่ละตัวทำคล้ายกัน:

```
1. กรอง host/path/method
2. parse request body หา prompt + model
3. ตรวจ client (header + body heuristic)
4. parse response — SSE stream → text + tokens
5. คำนวณ cost
6. _should_log(email) ? continue : drop
7. _write_local + threading.Thread(_send_log)
```

### 5. Discovery + sniffer (debug helpers)

| Class | หน้าที่ | output |
|---|---|---|
| `ClaudeAccountSniffer` | จับ email จาก `/api/auth/current_account`, `/api/account`, `/api/bootstrap/...` (whitelist เท่านั้น) เก็บใน `_ACCOUNT["email"]` | console + ใช้ใน monitors |
| `ClaudeConnectionLogger` | log SNI hostname ของทุก TLS handshake (รวม passthrough) — ใช้ค้น endpoint ใหม่ | `log/claude_connections.jsonl` |
| `ClaudeDesktopDiscovery` | log POST อื่นๆ บน claude.ai/anthropic ที่ยังไม่มี matcher | `log/claude_desktop_discovery.jsonl` |
| `ClaudeBridgeDiscovery` | log WS frame ของ bridge ที่ยังไม่รู้จัก | `log/claude_bridge_discovery.jsonl` |

### Pricing table

```python
_PRICE = {
    "opus":   dict(inp=15,   out=75,  cr=1.50, cw=18.75),
    "sonnet": dict(inp=3,    out=15,  cr=0.30, cw=3.75),
    "haiku":  dict(inp=0.80, out=4,   cr=0.08, cw=1.00),
}
```

USD ต่อ 1M tokens จับ tier จากชื่อ model (`opus` / `haiku` / fallback = sonnet)

### Schema ของแต่ละ JSONL entry

```json
{
  "id":                    "uuid",
  "ts":                    1777993204233,
  "client":                "claude-desktop-cowork",
  "account_email":         "user@softdebut.com",
  "machine_name":          "MY-PC",
  "model":                 "claude-sonnet-4-6",
  "prompt":                "ข้อความที่ผู้ใช้พิมพ์จริง",
  "prompt_chars":          17,
  "response_chars":        59,
  "input_tokens":          3,
  "output_tokens":         23,
  "cache_creation_tokens": 22784,
  "cache_read_tokens":     20830,
  "total_tokens":          43640,
  "cost_usd":              0.092043
}
```

---

## การติดตั้ง — Quick Start

ถ้า Worker + D1 deploy แล้ว และมี `config.py` พร้อมใช้:

```powershell
# 1. ติดตั้ง mitmproxy
pip install -r proxy\requirements.txt

# 2. รัน mitmdump ครั้งแรกเพื่อให้สร้าง CA cert
mitmdump --listen-port 8080
# (รอเห็น "Proxy server listening" แล้ว Ctrl+C)

# 3. ลง CA cert ลง Trusted Root (Run as Administrator)
proxy\install-cert.ps1

# 4. ตั้ง persistent env + Claude Code settings.json
proxy\install-claude-proxy.ps1

# 5. เริ่ม proxy
proxy\start.ps1
```

ปิด Claude Desktop / VSCode / `claude` CLI ที่เปิดอยู่ทั้งหมด แล้วเปิดใหม่ — ทุก client จะวิ่งผ่าน proxy

---

## การติดตั้ง — แบบละเอียด

### Prerequisites

- Windows 10/11 (script เป็น `.ps1` — Linux/macOS ดู [../SETUP.md](../SETUP.md))
- Python 3.9+ พร้อม `pip`
- สิทธิ์ Admin บน PowerShell (สำหรับลง CA cert)
- Cloudflare Worker + D1 deploy แล้ว (ดู [../SETUP.md ขั้นตอนที่ 1](../SETUP.md))

### ขั้นที่ 1 — ติดตั้ง mitmproxy

```powershell
pip install mitmproxy
# หรือ pip install -r proxy\requirements.txt
mitmdump --version
```

ถ้าไม่เจอ `mitmdump` ตรวจว่า `Python\Scripts\` อยู่ใน `PATH` หรือไม่ (ส่วนใหญ่เพิ่มอัตโนมัติเมื่อตั้ง "Add to PATH" ตอน install Python)

### ขั้นที่ 2 — ตั้ง `config.py`

```powershell
cd proxy
Copy-Item config.example.py config.py
notepad config.py
```

```python
WORKER_URL = "https://claude-monitor-xxx.<yourname>.workers.dev"
API_KEY    = "<key เดียวกับที่ตั้งไว้ใน wrangler secret put API_KEY>"
PROXY_PORT = 8080
```

> `config.py` อยู่ใน `.gitignore` — อย่า commit

### ขั้นที่ 3 — สร้าง CA cert

mitmproxy สร้าง self-signed CA ครั้งแรกที่รัน:

```powershell
mitmdump --listen-port 8080
# ดู log ว่ามี "Proxy server listening at *:8080" → Ctrl+C
```

ตรวจว่ามี cert:

```powershell
Test-Path "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"
# True
```

### ขั้นที่ 4 — ลง CA cert ลง Trusted Root

```powershell
# Run as Administrator
proxy\install-cert.ps1
```

หรือทำเอง:

```powershell
Import-Certificate `
  -FilePath "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem" `
  -CertStoreLocation Cert:\CurrentUser\Root
```

ตรวจสอบ:

```powershell
Get-ChildItem Cert:\CurrentUser\Root\* | Where-Object Subject -like "*mitmproxy*"
```

### ขั้นที่ 5 — เลือกวิธีตั้ง env vars

มี 3 วิธี ขึ้นกับ scope ที่ต้องการ:

| Script | Scope | เมื่อใช้ |
|---|---|---|
| `enable-proxy.ps1` | session ปัจจุบัน (dot-source) | ทดสอบเฉพาะ shell — ไม่อยากให้กระทบ shell อื่น |
| `install-proxy-env.ps1` | User-level permanent | ทุก process ที่ launch จาก explorer/Start menu inherit ทันที |
| `install-claude-proxy.ps1` | User env + เขียน `~/.claude/settings.json` | **แนะนำ** — Claude Desktop, Cowork worker subprocess, Claude Code CLI/VSCode ครอบคลุมหมด |

วิธีที่แนะนำ — รันแค่อันเดียวพอ:

```powershell
proxy\install-claude-proxy.ps1
```

จะตั้งให้:
- `~/.claude/settings.json` มี `env: { HTTPS_PROXY, HTTP_PROXY, NODE_EXTRA_CA_CERTS }`
- User-level env: `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE`

### ขั้นที่ 6 — เริ่ม proxy

```powershell
proxy\start.ps1
```

`start.ps1` รัน:

```
mitmdump -s addon.py --listen-port 8080 -q --allow-hosts "(anthropic\.com|claude\.ai|claudeusercontent\.com)"
```

console ควรเห็น (เมื่อมี traffic):

```
[claude-monitor] email filter OFF — logging all accounts
[claude-conn] SNI seen: claude.ai
[claude-conn] SNI seen: api.anthropic.com
[claude-account] ✓ detected email: user@example.com (from /api/auth/current_account)
[claude-api] claude-desktop-cowork | claude-sonnet-4-6 | in=3 out=23 | $0.09204
```

### ขั้นที่ 7 — ปิด-เปิด client ใหม่

**สำคัญมาก** — ทุก client ที่เปิดอยู่ก่อนตั้ง env ยังใช้ env เก่า:

```powershell
taskkill /F /IM Code.exe ; taskkill /F /IM claude.exe ; taskkill /F /IM Claude.exe
```

เปิดใหม่จาก Start menu ก็พอ ไม่ต้อง dot-source อะไรอีกเพราะ `install-claude-proxy.ps1` ตั้งเป็น User-level ไว้แล้ว

### ขั้นที่ 8 — ทดสอบ

```powershell
# ทดสอบ CLI
claude
> ทดสอบ neung
> /exit
```

ตรวจ log:

```powershell
Get-Content "log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl" | Select-Object -Last 1
```

ควรเห็น entry ใหม่ที่ `client: "claude-code-cli"` มี tokens > 0

---

## การใช้งานประจำวัน

### เริ่ม / หยุด

```powershell
# เริ่ม (รอใน foreground — Ctrl+C เพื่อหยุด)
proxy\start.ps1
```

### ดู log แบบสดๆ

```powershell
# ทุก call วันนี้
Get-Content "log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl" -Wait -Tail 5
```

### ดู connections (debug)

```powershell
# host ทุกตัวที่ client พยายาม reach (รวม passthrough)
Get-Content log\claude_connections.jsonl
```

### ปิดชั่วคราว — ไม่อยาก log

```powershell
# วิธี 1 — แค่หยุด proxy → request ทุกอันจะ ECONNREFUSED ทันที (ระวัง)
# วิธี 2 — uninstall env แล้ว Claude ทุกตัว bypass proxy
proxy\uninstall-claude-proxy.ps1
# แล้วปิด-เปิด client ทั้งหมด

# กลับมาใช้ → install-claude-proxy.ps1 อีกครั้ง
```

### Hot-reload addon.py

mitmproxy จะ re-import `addon.py` อัตโนมัติเมื่อแก้ไฟล์ — ไม่ต้อง restart `start.ps1` แค่ save `addon.py`

---

## ปรับแต่ง

### เปิด email filter

[addon.py](addon.py) ราวบรรทัด 38:

```python
EMAIL_FILTER_ENABLED   = True              # True = log เฉพาะที่ตรง substring
EMAIL_FILTER_SUBSTRING = "@yourcompany"    # case-insensitive
```

เมื่อเปิด:
- call ที่ไม่มี `account_email` (API key user) → drop
- call ที่ email ไม่มี substring → drop
- console จะ print `[claude-api] SKIP (filter) | ...`

### เปลี่ยน pricing

[addon.py](addon.py) ราวบรรทัด 89:

```python
_PRICE = {
    "opus":   dict(inp=15,   out=75,   cr=1.50,  cw=18.75),
    "sonnet": dict(inp=3,    out=15,   cr=0.30,  cw=3.75),
    "haiku":  dict(inp=0.80, out=4,    cr=0.08,  cw=1.00),
}
```

หน่วย: USD ต่อ 1M tokens

### เพิ่ม endpoint ใหม่

ถ้าเจอ host/path ใหม่ที่อยากดัก:

1. ดู `log/claude_connections.jsonl` หา SNI ที่น่าสนใจ
2. ดู `log/claude_desktop_discovery.jsonl` หา POST path ที่ยังไม่มี matcher
3. เพิ่ม class ใหม่ใน `addon.py` คล้าย `ClaudeDesktopMonitor`
4. เพิ่มใน list `addons` ท้ายไฟล์
5. ถ้าต้อง MITM host ใหม่ที่อยู่นอก regex — แก้ `start.ps1` ตัวแปร `$allowHosts`

### เปลี่ยน port

แก้ใน:
1. `config.py` → `PROXY_PORT = 8081`
2. `install-claude-proxy.ps1` (ถ้าใช้) → ตัวแปร `$proxyUrl`
3. `enable-proxy.ps1` → ตัวแปร `$proxyUrl`
4. `install-proxy-env.ps1` → ตัวแปร `$proxyUrl`
5. รัน `install-claude-proxy.ps1` ใหม่
6. ปิด-เปิดทุก client

---

## Troubleshooting

### `start.ps1` error `mitmdump not found`

```powershell
pip install mitmproxy
# ตรวจ
where.exe mitmdump
```

ถ้ายังไม่เจอ — Python Scripts ไม่อยู่ใน PATH:

```powershell
$env:PATH += ";$env:USERPROFILE\AppData\Local\Programs\Python\Python312\Scripts"
```

### Cert error / TLS handshake failed

อาการ: client error `unable to verify the first certificate` หรือ `self signed certificate`

แก้:

```powershell
# ตรวจว่ามี cert
Get-ChildItem Cert:\CurrentUser\Root\* | Where-Object Subject -like "*mitmproxy*"
# ถ้าไม่มี → run install-cert.ps1 ใหม่ (Admin)
```

สำหรับ Node.js: ตรวจว่า `NODE_EXTRA_CA_CERTS` ตั้งถูกต้อง:

```powershell
# ดู User-level
[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','User')
# ควรชี้ไป $env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem
```

### CLI/VSCode log ไม่ขึ้น แม้ proxy รันอยู่

สาเหตุพบบ่อย: process เก่ายังใช้ env เดิม

```powershell
# 1. ตรวจ env ของ process จริงๆ — เปิด PowerShell ใหม่
$env:HTTPS_PROXY
$env:NODE_EXTRA_CA_CERTS
# ทั้งคู่ไม่ควรว่าง

# 2. ปิดทุก process แล้วเปิดใหม่
taskkill /F /IM Code.exe
taskkill /F /IM claude.exe

# 3. ตรวจ TCP — Code.exe ควรมี connection ไปที่ 127.0.0.1:8080
Get-NetTCPConnection -State Established |
  Where-Object { $_.OwningProcess -in (Get-Process Code).Id } |
  Where-Object RemotePort -eq 8080
```

### Cowork ไม่ขึ้น log แต่ Chat tab ขึ้น

Cowork worker subprocess ถูก spawn จาก Claude Desktop process — มัน inherit env ของ parent ดังนั้น **ต้องตั้ง env เป็น User-level (permanent)** ไม่ใช่แค่ session:

```powershell
proxy\install-claude-proxy.ps1
# Quit Claude Desktop จาก system tray (ไม่ใช่แค่ปิดหน้าต่าง) แล้วเปิดใหม่
```

### `[DEBUG]` หรือไฟล์ debug_*.jsonl โผล่มา

addon.py อาจมี debug instrumentation ติดอยู่ — ตรวจ class `DebugAllFlows` หรือ block `_dbg = {...}` ใน `ClaudeAPIMonitor.response`. ลบออกถ้าไม่ใช้แล้ว

### Worker คืน 401

`API_KEY` ใน `config.py` ไม่ตรงกับ secret ที่ตั้งใน Worker:

```powershell
cd worker
wrangler secret put API_KEY
# พิมพ์ key เดียวกับใน config.py
npm run deploy
```

### request 400 — `tools.N.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf`

`ToolSchemaFixer` ควรจัดการให้แล้ว — ถ้ายังเจอ:

1. ตรวจว่า `ToolSchemaFixer()` อยู่ใน list `addons` ของ `addon.py` ท้ายไฟล์
2. ตรวจว่า mitmproxy reload แล้ว (mtime ของ `addon.py` กับ `__pycache__/` ควรห่างกันแค่ 1 วินาที)
3. ดู `log/schema_fixes.jsonl` — ถ้าว่าง = hook ยังไม่ทำงาน
4. ถ้า body มี shape อื่น — ดู error path เป๊ะๆ (`tools.47.custom.input_schema` หรือ `tools.47.input_schema`) แล้วปรับ check ใน `ToolSchemaFixer.request`

### ตรวจสอบว่า addon ทำงานถูก

```powershell
# ดู mtime — addon.py และ __pycache__ ควรห่างกัน <2 วินาที
Get-Item proxy\addon.py | Select-Object LastWriteTime
Get-ChildItem proxy\__pycache__\* | Select-Object LastWriteTime, Name
```

### ลบ proxy ออกหมด

```powershell
proxy\uninstall-claude-proxy.ps1
# ลบ Trusted Root cert (ถ้าต้องการ)
Get-ChildItem Cert:\CurrentUser\Root\* |
  Where-Object Subject -like "*mitmproxy*" |
  Remove-Item
# ปิด-เปิดทุก client
```

---

## โครงสร้างของ log files

```
log/
├── claude_2026-05-08.jsonl              # log หลัก — 1 บรรทัด = 1 call (โครงสร้างด้านบน)
├── claude_connections.jsonl             # SNI ของทุก TLS handshake
├── claude_desktop_discovery.jsonl       # POST อื่นๆ บน claude.ai/anthropic ที่ยังไม่ดัก
├── claude_bridge_discovery.jsonl        # WebSocket frame ของ bridge ที่ยังไม่รู้จัก
└── schema_fixes.jsonl                   # tool ที่ ToolSchemaFixer rewrite
```

ทั้งหมด append-only ลบเองได้ตลอด ไม่กระทบ proxy

---

## ลิงก์อ้างอิง

- [README หลัก](../README.md) — ภาพรวมระบบ
- [SETUP.md](../SETUP.md) — install ตั้งแต่ Worker + D1
- [DEVELOPER.md](../DEVELOPER.md) — internals + เพิ่มฟีเจอร์
- [mitmproxy docs](https://docs.mitmproxy.org/stable/addons-overview/) — addon API
