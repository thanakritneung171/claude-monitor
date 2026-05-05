# คู่มือนักพัฒนา 👨‍💻

เอกสารอ้างอิงสำหรับผู้แก้ไข/ต่อยอด Claude Monitor

## โครงสร้างโค้ด

```
claude-monitor/
├── proxy/
│   ├── addon.py                  # mitmproxy addon หลัก — entry point ทุกอย่าง
│   ├── config.py                 # WORKER_URL, API_KEY, PROXY_PORT
│   ├── config.example.py
│   ├── start.ps1                 # รัน mitmdump + addon (allow-hosts regex)
│   ├── install-claude-proxy.ps1  # ตั้ง persistent env vars + settings.json
│   └── uninstall-claude-proxy.ps1
├── worker/
│   └── src/index.ts              # Worker + Dashboard (ไฟล์เดียว)
└── log/                          # JSONL logs (auto)
```

---

## ทำความเข้าใจ `proxy/addon.py`

### ลำดับการลงทะเบียน addons

```python
addons = [
    ClaudeConnectionLogger(),   # 0. log SNI ของทุก TLS connection
    ClaudeAccountSniffer(),     # 1. sniff email ก่อน — ให้ email พร้อมตอน log
    ClaudeAPIMonitor(),         # 2. api.anthropic.com/v1/messages (รวม ?beta=true)
    ClaudeDesktopMonitor(),     # 3. claude.ai/.../completion (Chat ปกติ)
    ClaudeDesktopDiscovery(),   # 4. debug — POST อื่นๆ ที่ไม่มี matcher
    ClaudeBridgeMonitor(),      # 5. bridge.claudeusercontent.com WS (Code OAuth, Cowork chrome)
    ClaudeBridgeDiscovery(),    # 6. debug — WS frames ที่ไม่รู้จัก
]
```

> **ลำดับสำคัญ:** `ClaudeAccountSniffer` ต้องอยู่ก่อน Monitor ทุกตัวที่เขียน log — เพื่อให้ `current_email()` มีค่าก่อนถูก call

---

## Monitor classes

### ClaudeAPIMonitor

ดักจับ `api.anthropic.com/v1/messages` (รวม `?beta=true`)

**ครอบคลุม:**
- Claude Code CLI (API key หรือ OAuth ที่ใช้ /v1/messages)
- Claude Code VSCode
- Cowork (Desktop)
- Code tab (Desktop)
- Raw API SDK ใดก็ตาม

**ขั้นตอน:**

```python
def response(self, flow):
    if flow.request.host != "api.anthropic.com": return
    path = flow.request.path.split("?", 1)[0]   # ตัด query (?beta=true)
    if path != "/v1/messages": return
    if flow.request.method != "POST": return

    req       = json.loads(flow.request.content)
    model     = req.get("model")
    messages  = req.get("messages", [])
    prompt    = _extract_prompt_api(messages)
    client    = _detect_client(flow.request.headers)

    # Body override (ทำหลัง header detection)
    if _looks_like_cowork(req, headers):
        client = "claude-desktop-cowork"
    elif _looks_like_code(req) and client == "api":
        client = "claude-code-cli"

    parsed = _parse_sse_api(resp_text)  # หรือ JSON fallback
    self._log(client, model, prompt, parsed)
```

### ClaudeDesktopMonitor

ดัก `claude.ai/api/organizations/{org}/chat_conversations/{conv}/completion`

ใช้โดย Claude Desktop / Claude.ai web ในโหมด Chat ปกติ

**รองรับ:**
- SSE (`event-stream`) — streaming response
- JSON fallback — non-streaming response

### ClaudeBridgeMonitor

ดัก WebSocket session ที่ `bridge.claudeusercontent.com`

ใช้โดย Claude Code OAuth (account login) และ Cowork chrome agent

**โปรโตคอลที่รองรับ:**
- **Format A**: Wrapped HTTP — `{type: "request", id, body: {messages, ...}}`
- **Format B**: Raw API — `{messages: [...], model: ...}` (no wrapper)
- **Format C**: Unknown — log ลง discovery file

**State per session:** เก็บ pending requests, accumulate streaming events, flush เมื่อเจอ completion signal (`message_stop` / `done` / `complete` / `end`)

### ClaudeAccountSniffer

อ่าน email จาก response ของ claude.ai โดยใช้ **whitelist regex**:

```python
WHITELIST = [
    r"^/api/auth/current_account$",
    r"^/api/account/?$",
    r"^/(api|edge-api)/bootstrap(/[^/]+){0,2}/?$",
]
```

**ทำไมต้อง whitelist:** claude.ai มี endpoint หลายตัวที่ return email field — เช่น org member list, support email config — ถ้า search ทั้งหมดจะได้ email ผิดคน เห็น discovery print ก่อนเพิ่มลง whitelist

---

## Discovery classes

### ClaudeConnectionLogger

ใช้ `tls_clienthello` hook ของ mitmproxy — fire ทุก connection (รวม passthrough)

**ใช้ทำอะไร:** หา host ใหม่ที่ Claude/subprocess เชื่อมต่อ แต่ proxy ยังไม่ MITM

```python
def tls_clienthello(self, data):
    sni = (data.client_hello.sni or "").lower()
    if not sni or sni in self._SEEN: return
    self._SEEN.add(sni)
    # log ลง log/claude_connections.jsonl
```

### ClaudeDesktopDiscovery / ClaudeBridgeDiscovery

Log POST/WS ที่ Monitor classes ไม่ handle → ใช้ค้นหา endpoint ใหม่ที่ Anthropic ออก

---

## Helper functions

### `_detect_client(headers) -> str`

อ่าน 4 headers แล้วตัดสิน:

```python
ua             = "user-agent"
name           = "anthropic-client-name"
app            = "x-app"
ctx            = "x-client-context"

is_claude_code = any "claude-code" ใน 3 ช่องแรก
is_electron    = "electron" ใน ua  # ไม่เอา "claude/" เพราะ CLI ก็มี
is_vscode      = "vscode" ใน ctx/ua/name
```

**Decision tree:**

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

### `_looks_like_cowork(req, headers) -> bool`

True ถ้า body มี `mcp__cowork__*` ใน tools หรือ metadata มีคำว่า cowork

### `_looks_like_code(req) -> bool`

True ถ้า body มี Claude Code's classic tools (`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Task`, `TodoWrite`, `WebFetch`, `WebSearch`, `MultiEdit`, `NotebookEdit`, `ExitPlanMode`, `BashOutput`, `KillBash`) **และไม่มี `mcp__cowork__*`**

### `_extract_prompt_api(messages) -> str`

หา user message ตัวสุดท้าย แล้ว:
- ถ้า content เป็น string → คืนค่าเลย
- ถ้าเป็น list ของ blocks → กรอง text blocks → ข้าม block ที่เริ่มด้วย `<system-reminder>` (Cowork inject) → คืน text สุดท้าย

### `_parse_sse_api(text) / _parse_sse_desktop(text)`

วน SSE lines, สะสม `text_delta`, ดึง `usage` จาก `message_start` / `message_delta`

### `_calc_cost(model, inp, out, cr, cw) -> float`

```python
tier = "opus" if "opus" in model else \
       "haiku" if "haiku" in model else \
       "sonnet"
p = _PRICE[tier]
return (inp*p["inp"] + out*p["out"] + cr*p["cr"] + cw*p["cw"]) / 1_000_000
```

### `_should_log(email) -> bool`

```python
if not EMAIL_FILTER_ENABLED: return True
if not EMAIL_FILTER_SUBSTRING: return True
return EMAIL_FILTER_SUBSTRING.lower() in (email or "").lower()
```

ใช้ก่อน `_write_local()` และ `_send_log()` ทุกที่

### `_send_log(payload)`

ใช้ urllib opener ที่ bypass system proxy:

```python
_no_proxy_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
```

**เหตุผล:** addon รันใน mitmproxy → ถ้าส่ง POST ผ่าน system proxy จะ loopback กลับมาหาตัวเอง (deadlock)

---

## Worker — `worker/src/index.ts`

### POST /log

```typescript
if (request.headers.get('X-Api-Key') !== env.API_KEY) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
}
await env.DB.prepare(`INSERT OR IGNORE INTO api_logs ...`).bind(...).run();
```

`INSERT OR IGNORE` กัน duplicate กรณี addon retry

### GET /

Query parallel แล้ว build HTML inline:

```typescript
const [rows, totals, byModel, byClient, byMachine, byAccount] =
    await Promise.all([...]);
```

ไม่ใช้ framework — inline CSS + JS เพื่อ deploy ง่าย

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
        model  = req.get("model", "unknown")

        # Parse response (depends on format)
        # ...

        email = current_email()
        if not _should_log(email):
            return

        log = {
            "id":            str(uuid.uuid4()),
            "ts":            int(datetime.now().timestamp() * 1000),
            "client":        _detect_client(flow.request.headers),
            "account_email": email,
            "machine_name":  HOSTNAME,
            "model":         model,
            "prompt":        prompt,
            # ... ฯลฯ
        }
        _write_local(log)
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()

addons.append(MyNewMonitor())
```

### เพิ่ม model pricing

```python
_PRICE = {
    "opus":   dict(inp=15,   out=75,   cr=1.50, cw=18.75),
    "sonnet": dict(inp=3,    out=15,   cr=0.30, cw=3.75),
    "haiku":  dict(inp=0.80, out=4,    cr=0.08, cw=1.00),
    # ถ้ามี tier ใหม่ → เพิ่มที่นี่
}
```

`_calc_cost` ปัจจุบันจับ tier ด้วย substring (`"opus" in model`) — ถ้า model name format เปลี่ยน ต้องอัปเดต logic

### เพิ่ม client tag ใหม่

1. เพิ่ม signal ใน `_detect_client` (header check) **หรือ** เพิ่ม `_looks_like_xxx` function (body check)
2. ใน Monitor class — apply override หลัง `_detect_client`
3. (ถ้าต้องการแสดงใน Dashboard) — Worker query already groups by `client` อัตโนมัติ ไม่ต้องเพิ่มอะไร

### เพิ่ม column / chart ใน Dashboard

1. เพิ่ม SQL query:

```typescript
const byDay = await env.DB.prepare(`
    SELECT DATE(ts/1000, 'unixepoch') as day,
           COUNT(*) as calls,
           SUM(cost_usd) as cost
    FROM api_logs
    GROUP BY day ORDER BY day DESC LIMIT 30
`).all();
```

2. Render HTML ใน `buildDashboard()`:

```typescript
const dailyRows = byDay.results.map(d =>
    `<tr><td>${d.day}</td><td class="r">${num(d.calls)}</td><td class="r">$${num(d.cost, 4)}</td></tr>`
).join('');
```

---

## Cowork & Subprocess Bypass — เรื่องที่ต้องรู้

### ปัญหา

Claude Desktop ของ Cowork มี **worker subprocess** ที่ไม่อ่าน Windows system proxy setting — โดย default มันต่อตรงไป Anthropic IPs (160.79.104.x) **ข้าม mitmproxy**

### วิธีแก้

`install-claude-proxy.ps1` ตั้ง **persistent user env vars** (HTTPS_PROXY, NODE_EXTRA_CA_CERTS, ฯลฯ) ที่ระดับ User registry

เมื่อ Claude Desktop launch ใหม่ → child processes inherit env vars → ใช้ proxy ตาม

### Path ของ Cowork: `?beta=true`

Cowork (และ Desktop Code tab) ใช้ `api.anthropic.com/v1/messages?beta=true` (มี query string) — ไม่ใช่ path เดียวกับ Chat tab (ที่ใช้ `claude.ai/.../completion`)

**ใน addon:** ต้อง strip query ก่อน match path:

```python
path = flow.request.path.split("?", 1)[0]
if path != "/v1/messages": return
```

### `<system-reminder>` blocks

Cowork inject `<system-reminder>` blocks (ลิสต์ MCP tools) ไว้ก่อน user prompt จริงในแต่ละ user message

`_extract_prompt_api` ต้องข้าม blocks เหล่านี้:

```python
texts = [...all text blocks...]
user_texts = [t for t in texts if not t.lstrip().startswith("<system-reminder>")]
return user_texts[-1] if user_texts else texts[-1]
```

---

## Debug

### mitmproxy verbose mode

```powershell
mitmdump -s addon.py --listen-port 8080 -vv
```

### เพิ่ม print debug ใน addon

```python
def response(self, flow):
    print(f"[DEBUG] {flow.request.host}{flow.request.path} "
          f"ua={flow.request.headers.get('user-agent','')[:80]}")
```

### หา endpoint ใหม่ที่ Claude ออก

```powershell
# 1. ส่ง prompt ผ่าน Claude tool ที่สงสัย
# 2. ดู discovery file
Get-Content log\claude_desktop_discovery.jsonl | Select-Object -Last 5
Get-Content log\claude_connections.jsonl
```

### ทดสอบ Worker /log โดยตรง

```powershell
curl -X POST https://your-worker.workers.dev/log `
  -H "X-Api-Key: MySecretKey123" `
  -H "Content-Type: application/json" `
  -d '{"id":"test-001","ts":1234567890000,"client":"api","model":"claude-sonnet-4-6","prompt":"test","input_tokens":10,"output_tokens":5,"cost_usd":0.00001}'
```

### Query D1 schema

```powershell
wrangler d1 execute claude-monitor --remote --command ".schema"
wrangler d1 execute claude-monitor --remote --command "SELECT COUNT(*) FROM api_logs"
```

---

## ปัญหาในการพัฒนา

| ปัญหา | วิธีตรวจ |
|---|---|
| addon โหลดไม่ได้ | `python -m py_compile proxy/addon.py` |
| Worker deploy ไม่ได้ | ตรวจ `database_id` ใน `wrangler.toml`, `wrangler login` |
| D1 query ว่าง | `wrangler d1 execute --command ".tables"` |
| Dashboard ไม่โหลด | `wrangler tail` ดู error real-time |
| addon ไม่ดักจับ | ตรวจ `--allow-hosts` regex, ลอง `-vv` mode |
| log ไม่เขียน | ตรวจสิทธิ์ write `log/` directory |
| Cowork ไม่ขึ้น log | ยังไม่รัน `install-claude-proxy.ps1` หรือยังไม่ได้ restart Claude Desktop |
| Code/Cowork tag ผิด | ตรวจ `_looks_like_cowork`, `_looks_like_code` heuristics |
| Email filter กรองทิ้งหมด | sniffer ยังไม่เจอ email — เปิด Claude Desktop แล้ว login ก่อน |

---

## Performance

### กรณี calls หลายพัน/วัน

**เพิ่ม index:**

```bash
wrangler d1 execute claude-monitor --remote --command "
CREATE INDEX IF NOT EXISTS idx_model_ts ON api_logs(model, ts DESC);
CREATE INDEX IF NOT EXISTS idx_client_ts ON api_logs(client, ts DESC);
"
```

**ลบ log เก่าอัตโนมัติ (cron job):**

```bash
wrangler d1 execute claude-monitor --remote --command \
  "DELETE FROM api_logs WHERE ts < (strftime('%s', 'now', '-90 days') * 1000)"
```

**Truncate prompt ใหญ่ๆ:**

```python
log["prompt"]       = prompt[:500]   # เก็บแค่ 500 ตัวแรก
log["prompt_chars"] = len(prompt)    # นับเต็ม
```

---

## ไฟล์อ้างอิง

| ไฟล์ | หน้าที่ |
|------|---------|
| [proxy/addon.py](proxy/addon.py) | mitmproxy addon หลัก |
| [proxy/config.py](proxy/config.py) | ค่าตั้งต้น (ต้องสร้างเอง) |
| [proxy/config.example.py](proxy/config.example.py) | template |
| [proxy/start.ps1](proxy/start.ps1) | start mitmdump + addon |
| [proxy/install-claude-proxy.ps1](proxy/install-claude-proxy.ps1) | ตั้ง persistent env + settings.json |
| [proxy/uninstall-claude-proxy.ps1](proxy/uninstall-claude-proxy.ps1) | ล้าง persistent env + settings.json |
| [proxy/enable-proxy.ps1](proxy/enable-proxy.ps1) | env vars เฉพาะ session |
| [proxy/disable-proxy.ps1](proxy/disable-proxy.ps1) | คืน session env |
| [worker/src/index.ts](worker/src/index.ts) | Worker + Dashboard |
| [worker/wrangler.toml](worker/wrangler.toml) | Cloudflare config |
