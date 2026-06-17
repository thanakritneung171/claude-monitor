# คู่มือนักพัฒนา 👨‍💻

เอกสารอ้างอิงสำหรับผู้แก้ไข/ต่อยอด Claude Monitor

> ภาพรวมระบบ: [README.md](README.md) · proxy เชิงลึก: [proxy/PROXY-GUIDE.md](proxy/PROXY-GUIDE.md) · worker เชิงลึก: [worker/WORKER-GUIDE.md](worker/WORKER-GUIDE.md) · ระบบ identity: [CONTEXT-PROMPT-LOG-SYSTEM.md](CONTEXT-PROMPT-LOG-SYSTEM.md)

## โครงสร้างโค้ด

```
claude-monitor/
├── proxy/
│   ├── addon.py                  # mitmproxy addon หลัก — entry point ทุกอย่าง
│   ├── config.py                 # WORKER_URL, API_KEY, PROXY_PORT, EMAIL_FILTER_*
│   ├── config.example.py
│   ├── identity_cache.json       # persistent identity map (account_uuid→email ฯลฯ)
│   ├── seed_from_segment.py      # เติม identity_cache จาก log เก่า (one-off)
│   ├── start.ps1                 # รัน mitmdump + addon (allow-hosts regex)
│   ├── install-claude-proxy.ps1  # ตั้ง persistent env vars + settings.json
│   └── uninstall-claude-proxy.ps1
├── worker/
│   ├── src/
│   │   ├── index.ts              # route dispatcher (ดู endpoint ทั้งหมดในที่เดียว)
│   │   ├── types.ts              # ApiLog, Filters, Env
│   │   ├── routes/               # 1 ไฟล์ = 1 endpoint (log, dashboard, logs, analytics, …)
│   │   ├── db/                   # queries.ts, queries-extra.ts, filters.ts
│   │   ├── lib/                  # auth, account, badge, csv, xlsx, date, format, logo
│   │   └── views/               # *.html + *.css + *.client.js + *.ts (render)
│   ├── schema.sql                # init schema (api_logs + auth tables)
│   ├── migrations/               # 0001–0011 ALTER scripts (ถึง email_identity)
│   └── wrangler.jsonc            # deploy config + D1 binding + LOGTO_* vars
└── log/                          # JSONL logs (auto)
```

---

## ทำความเข้าใจ `proxy/addon.py`

### ลำดับการลงทะเบียน addons

```python
addons = [
    IdentityDebug(),             # (ชั่วคราว) debug การ resolve identity ต่อ request
    ClaudeConnectionLogger(),    # log SNI ของทุก TLS connection
    ToolSchemaFixer(),           # request hook — flatten oneOf/allOf/anyOf
    ClaudeAccountSniffer(),      # sniff email ก่อน — ให้ email พร้อมตอน log
    ClaudeCodeMetricsMonitor(),  # /api/claude_code/metrics → uuid→email map + device info
    ClaudeAPIMonitor(),          # api.anthropic.com/v1/messages (รวม ?beta=true)
    ClaudeDesktopMonitor(),      # claude.ai/.../completion (Chat ปกติ)
    ClaudeDesktopDiscovery(),    # debug — POST อื่นๆ ที่ไม่มี matcher
    ClaudeBridgeMonitor(),       # bridge.claudeusercontent.com WS (Code OAuth)
    ClaudeBridgeDiscovery(),     # debug — WS frames ที่ไม่รู้จัก
]
```

> **ลำดับสำคัญ:** sniffer/metrics ต้องอยู่ก่อน Monitor ที่เขียน log — เพื่อให้ `current_email()` มีค่าก่อนถูก call
> `ClaudeSegmentMonitor` ยังมีในไฟล์แต่ **เลิกใช้** (Segment host ไม่มี session cookie)

---

## ระบบระบุตัวตน — `current_email()` (ไม่ใช้ IP)

หัวใจของระบบรุ่นนี้คือ **ระบุตัวตนจาก token ที่ request พกมาเอง** (VPN-safe) ไม่เดาจาก IP

```python
def current_email(flow) -> str:
    return (_jwt_email(flow)                       # 1) JWT email claim
            or _EMAIL_BY_UUID.get(meta_uuid)       # 2) account_uuid (Claude Code, แม้ raw sk-)
            or _EMAIL_BY_TOKEN.get(bearer_hash)    # 3) OAuth token (เติมจาก metrics)
            or _EMAIL_BY_SESSION.get(sess_hash))   # 4) session cookie (claude.ai chat)
```

**Cache (ทั้งหมด keyed ด้วย email หรือ token — ไม่ใช่ IP):**

| ตัวแปร | key → value |
|---|---|
| `_ACCOUNT_BY_EMAIL` | email → {name, uuid, account_id, org_id} |
| `_DEVICE_BY_EMAIL` | email → {app_version, os_type, os_version, host_arch, terminal, device_id, mac_address} |
| `_EMAIL_BY_UUID` | account_uuid → email (**ลิงก์หลักของ Claude Code**) |
| `_EMAIL_BY_TOKEN` | sha256(OAuth Bearer token) → email |
| `_EMAIL_BY_SESSION` | sha256(sessionKey cookie) → email |

**`ClaudeCodeMetricsMonitor`** เป็นกลไกหลัก: ดัก `POST /api/claude_code/metrics` ที่ body มี `user.email` + `user.account_uuid` + `account_id` + `organization.id` + OS/arch/version → สร้าง `_EMAIL_BY_UUID` / `_EMAIL_BY_TOKEN` + เก็บ device info ทำให้ prompt ตัวถัดมา (ที่พก `account_uuid` ใน `metadata.user_id`) resolve email ได้แม้ login ด้วย raw `sk-` key

**Persistent identity:** `_persist_identity()` เขียน map ลง `proxy/identity_cache.json` และ `_load_identity_seed()` โหลดกลับตอน start — prompt resolve ได้ทันทีไม่ต้องรอ metrics ยิงใหม่ (รองรับการเติม `"uuid": "email"` เองในไฟล์ + legacy `uuid_email_map.json` แบบ load-only)

---

## Monitor classes

### ClaudeAPIMonitor

ดักจับ `api.anthropic.com/v1/messages` (รวม `?beta=true`) — ครอบคลุม CLI / VSCode / Cowork / Code tab / raw API SDK

```python
def response(self, flow):
    if flow.request.host != "api.anthropic.com": return
    path = flow.request.path.split("?", 1)[0]   # ตัด query (?beta=true)
    if path != "/v1/messages": return
    ...
    client = _detect_client(flow.request.headers)
    if _looks_like_cowork(req, headers):     client = "claude-desktop-cowork"
    elif _looks_like_code(req) and client == "api": client = "claude-code-cli"
    email  = current_email(flow)             # resolve จาก token ของ request
    if not _should_log(email): return        # email filter
    self._log(flow, client, model, prompt, _parse_sse_api(resp_text))
```

`request()` ยังถอด JWT ของ `/v1/messages` (ถ้าเป็น JWT จริง) เก็บ email/name/sub เข้า `_set_account_email()` ครอบคลุมกรณี traffic วิ่งตรง api.anthropic.com

### ClaudeDesktopMonitor

ดัก `claude.ai/api/organizations/{org}/chat_conversations/{conv}/completion` (Claude Desktop / web chat) — รองรับทั้ง SSE และ JSON fallback resolve email ผ่าน session cookie

### ClaudeBridgeMonitor

ดัก WebSocket ที่ `bridge.claudeusercontent.com` (Claude Code OAuth) อ่าน `account.email_address` จาก `connect` handshake (ลองหลาย shape) แล้ว flush log ทุกครั้งที่ stream ตอบจบ — map `client_type` → ชื่อ client (`claude-code`→`claude-code-cli`, `vscode`→`claude-code-vscode`)

### ClaudeAccountSniffer

อ่าน email จาก response ของ claude.ai โดยใช้ **whitelist** เท่านั้น:

```python
WHITELIST = [r"^/api/auth/current_account$", r"^/api/account/?$",
             r"^/(api|edge-api)/bootstrap(/[^/]+){0,2}/?$"]
```

**ทำไมต้อง whitelist:** claude.ai มีหลาย endpoint ที่ return email field (org member list, support email) — search ทั้งหมดจะได้ email ผิดคน ใช้ `_extract_current_user` อ่านเฉพาะ shape ที่รู้จัก (ไม่ recursive) ผูก email กับ `sha256(sessionKey)` เก็บใน `_EMAIL_BY_SESSION`

### ToolSchemaFixer (request hook)

แก้ tool ที่ `input_schema` (หรือ `custom.input_schema`) มี `oneOf/allOf/anyOf` ระดับ root — Anthropic API ปฏิเสธ → flatten เป็น `{"type":"object","additionalProperties":true}` log ลง `log/schema_fixes.jsonl` (บาง MCP connector ของ claude.ai เช่น Notion/Google Drive ส่ง schema แบบนี้มา)

---

## Helper functions

### `_detect_client(headers) -> str`

อ่าน 4 headers (`user-agent`, `anthropic-client-name`, `x-app`, `x-client-context`) แล้วตัดสิน:

```
is_claude_code?
├── electron + ไม่ใช่ vscode  →  claude-desktop-code
├── vscode                    →  claude-code-vscode
└── else                      →  claude-code-cli
ไม่ใช่ claude_code:
├── vscode                    →  claude-code-vscode
├── electron / anthropic      →  claude-desktop
└── else                      →  api
```

### `_looks_like_cowork(req, headers)` / `_looks_like_code(req)`

- cowork: body มี tool ชื่อขึ้นต้น `mcp__cowork` หรือ metadata มีคำว่า cowork
- code: body มี tool ใน `_CODE_TOOLS` (`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Task`, `TodoWrite`, `WebFetch`, `WebSearch`, `MultiEdit`, `NotebookEdit`, `ExitPlanMode`, `BashOutput`, `KillBash`) **และไม่มี** `mcp__cowork`

### `_extract_prompt_api(messages) -> str`

หา user message ตัวสุดท้าย — ถ้าเป็น list ของ blocks กรอง text blocks แล้ว **ข้าม block ที่เริ่มด้วย `<system-reminder>`** (ที่ harness inject) คืน text สุดท้ายที่เหลือ

### `_calc_cost(model, inp, out, cr, cw) -> float`

```python
tier = "opus" if "opus" in model else "haiku" if "haiku" in model else "sonnet"
p = _PRICE[tier]
return (inp*p["inp"] + out*p["out"] + cr*p["cr"] + cw*p["cw"]) / 1_000_000
```

### `_send_log(payload)`

ใช้ urllib opener ที่ bypass system proxy (`ProxyHandler({})`) — addon รันใน mitmproxy ถ้าส่ง POST ผ่าน system proxy จะ loopback กลับมาหาตัวเอง

---

## Worker — `worker/src/` (modular)

`index.ts` เป็น **dispatcher** เท่านั้น — เห็น route ทั้งหมดในที่เดียว แล้ว import handler จาก `routes/`

```typescript
// public
if (pathname === '/log'    && method === 'POST') return handleLog(request, env);
if (pathname === '/health')                       return handleHealth();
if (pathname === '/login'  && method === 'GET')   return handleLoginGet(url, env, request);
// authenticated (ผ่าน Logto)
const gate = await requireUser(request, env);
if (gate.response) return gate.response;
if (pathname === '/'        && method === 'GET') return handleDashboard(url, env, user);
if (pathname === '/logs'    && method === 'GET') return handleLogs(url, env, user);
// ... accounts, analytics, identity, new-identity, insights, reports, monitoring, export, settings, clear-data
```

### POST /log (`routes/log.ts`)

ตรวจ `X-Api-Key` → `insertLog()` (`INSERT OR IGNORE` กัน duplicate) → ถ้ามี `account_email` จริง เรียก `upsertEmailIdentity()` อัปเดตทะเบียน canonical แบบ non-destructive (ค่าใหม่ว่างไม่ทับค่าเดิม, `client_types` ต่อท้ายแบบ dedupe)

### Auth = Logto OIDC

ทุก dashboard route ป้องกันด้วย Logto (ไม่ใช่ local password อีกแล้ว — migration `0003_logto.sql` drop ตาราง `users`) config ผ่าน `wrangler.jsonc` → `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_REDIRECT_URI`, `LOGTO_POST_LOGOUT_REDIRECT_URI` ใช้ `jose` ตรวจ token เก็บ session ใน D1 (`sessions`, `oauth_state`)

---

## เพิ่มฟีเจอร์ใหม่

### เพิ่ม Monitor class สำหรับ endpoint ใหม่

```python
class MyNewMonitor:
    def response(self, flow: http.HTTPFlow):
        if "my-endpoint.com" not in flow.request.host: return
        if flow.request.path != "/api/chat": return
        req    = json.loads(flow.request.content)
        prompt = req.get("message", "")
        email  = current_email(flow)
        if not _should_log(email): return
        log = { "id": str(uuid.uuid4()), "ts": int(datetime.now().timestamp()*1000),
                "client": _detect_client(flow.request.headers),
                "account_email": email, "client_ip": _client_ip(flow),
                "model": req.get("model","unknown"), "prompt": prompt,
                **_device_info(email) }
        _write_local(log)
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()

addons.append(MyNewMonitor())
```

### เพิ่ม model pricing

```python
_PRICE = {
    "opus":   dict(inp=15,   out=75, cr=1.50, cw=18.75),
    "sonnet": dict(inp=3,    out=15, cr=0.30, cw=3.75),
    "haiku":  dict(inp=0.80, out=4,  cr=0.08, cw=1.00),
}
```

`_calc_cost` จับ tier ด้วย substring (`"opus" in model`) — ถ้า model name format เปลี่ยน ต้องอัปเดต logic

### เพิ่มหน้า/route ใน Worker

1. สร้างไฟล์ใน `worker/src/routes/` export `handleXxx(url, env, user)`
2. เพิ่ม SQL ที่ต้องใช้ใน `db/queries.ts` (หรือ `queries-extra.ts`)
3. สร้าง view ใน `views/` (`.html` + `.css` + `.ts` render)
4. register route ใน `index.ts`
5. (ถ้าต้องการอยู่ใน sidebar) เพิ่มลิงก์ใน `views/sidebar.html`

---

## Debug

```powershell
# verbose mode
mitmdump -s addon.py --listen-port 8080 -vv

# ดู discovery / identity debug
Get-Content log\claude_desktop_discovery.jsonl | Select-Object -Last 5
Get-Content log\identity_debug.jsonl | Select-Object -Last 5
Get-Content log\claude_connections.jsonl

# ทดสอบ Worker /log โดยตรง
curl -X POST https://claude-monitor-hooks.<name>.workers.dev/log `
  -H "X-Api-Key: <key>" -H "Content-Type: application/json" `
  -d '{"id":"test-001","ts":1234567890000,"client":"api","model":"claude-sonnet-4-6","prompt":"test","input_tokens":10,"output_tokens":5,"cost_usd":0.00001}'

# Query D1
wrangler d1 execute prompt-logger --remote --command ".schema"
wrangler d1 execute prompt-logger --remote --command "SELECT COUNT(*) FROM api_logs"
```

---

## ปัญหาในการพัฒนา

| ปัญหา | วิธีตรวจ |
|---|---|
| addon โหลดไม่ได้ | `python -m py_compile proxy/addon.py` |
| Worker deploy ไม่ได้ | ตรวจ `database_id` ใน `wrangler.jsonc`, `wrangler login` |
| D1 query ว่าง | `wrangler d1 execute prompt-logger --command ".tables"` |
| Dashboard ไม่โหลด / login วน | ตรวจ `LOGTO_*` ใน wrangler.jsonc + `wrangler tail` |
| addon ไม่ดักจับ | ตรวจ `--allow-hosts` regex, ลอง `-vv` mode |
| Cowork ไม่ขึ้น log | ยังไม่รัน `install-claude-proxy.ps1` หรือยังไม่ได้ restart Claude Desktop |
| Email filter กรองทิ้งหมด | identity ยัง resolve ไม่ได้ — เปิด/ใช้ client ที่ยิง metrics ก่อน หรือเติม `identity_cache.json` |
| Code/Cowork tag ผิด | ตรวจ `_looks_like_cowork`, `_looks_like_code` heuristics |

---

## Performance

```bash
# เพิ่ม composite index (calls หลายพัน/วัน)
wrangler d1 execute prompt-logger --remote --command "
CREATE INDEX IF NOT EXISTS idx_model_ts  ON api_logs(model, ts DESC);
CREATE INDEX IF NOT EXISTS idx_client_ts ON api_logs(client, ts DESC);"

# ลบ log เก่า
wrangler d1 execute prompt-logger --remote --command \
  "DELETE FROM api_logs WHERE ts < (strftime('%s','now','-90 days') * 1000)"
```

---

## ไฟล์อ้างอิง

| ไฟล์ | หน้าที่ |
|------|---------|
| [proxy/addon.py](proxy/addon.py) | mitmproxy addon หลัก |
| [proxy/config.py](proxy/config.py) | ค่าตั้งต้น (สร้างเอง) · [config.example.py](proxy/config.example.py) template |
| [proxy/identity_cache.json](proxy/identity_cache.json) | persistent identity map |
| [worker/src/index.ts](worker/src/index.ts) | route dispatcher |
| [worker/schema.sql](worker/schema.sql) | init schema · [migrations/](worker/migrations/) ALTER scripts |
| [worker/wrangler.jsonc](worker/wrangler.jsonc) | Cloudflare config + LOGTO vars |
