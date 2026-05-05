# คู่มือนักพัฒนา 👨‍💻

เอกสารอ้างอิงสำหรับผู้ที่ต้องการแก้ไขหรือต่อยอดระบบ Claude Monitor

## โครงสร้างโค้ด

```
claude-monitor/
├── proxy/
│   ├── addon.py              # mitmproxy addon หลัก — จุดเริ่มต้นทุกอย่าง
│   ├── config.py             # ค่าตั้งต้น: WORKER_URL, API_KEY, PROXY_PORT
│   └── config.example.py     # template
│
├── worker/
│   ├── src/index.ts          # Worker + HTML dashboard (ไฟล์เดียวจบ)
│   └── wrangler.toml
│
└── log/                      # JSONL logs (auto-created)
```

---

## อธิบาย proxy/addon.py

### การทำงานของ mitmproxy Addon

mitmproxy จะเรียก `response()` ทุกครั้งที่ได้รับ HTTP response — addon แต่ละตัวจะตรวจว่า flow นั้นเกี่ยวข้องกับตัวเองหรือเปล่า แล้วจึงทำงาน

```python
addons = [
    ClaudeAccountSniffer(),     # 1. ตรวจ email ก่อน
    ClaudeAPIMonitor(),         # 2. ดัก api.anthropic.com
    ClaudeDesktopMonitor(),     # 3. ดัก claude.ai
    ClaudeDesktopDiscovery(),   # 4. debug: บันทึก POST อื่นๆ
    ClaudeBridgeDiscovery(),    # 5. debug: บันทึก WebSocket
]
```

> **สำคัญ:** `ClaudeAccountSniffer` ต้องอยู่ก่อนเสมอ เพื่อให้ email พร้อมก่อนที่ completion จะถูก log

---

### ClaudeAPIMonitor

ดักจับ `api.anthropic.com/v1/messages` — ใช้โดย Claude Code และ API key users

```python
def response(self, flow: http.HTTPFlow):
    # 1. กรองเฉพาะ request ที่ต้องการ
    if flow.request.host   != "api.anthropic.com": return
    if flow.request.path   != "/v1/messages":       return
    if flow.request.method != "POST":               return

    # 2. อ่าน request body → ดึง model + prompt
    req    = json.loads(flow.request.content)
    model  = req.get("model", "unknown")
    prompt = _extract_prompt_api(req.get("messages", []))

    # 3. Parse response (SSE หรือ JSON)
    parsed = _parse_sse_api(resp_text)  # or json parse

    # 4. บันทึก
    self._log(client, model, prompt, parsed)
```

---

### ClaudeDesktopMonitor

ดักจับ `claude.ai/api/organizations/.../completion` — ใช้โดย Claude Desktop app

รองรับ 2 formats:
- **SSE** (`event-stream`) — response เป็น stream
- **JSON** — response ธรรมดา (fallback)

---

### ClaudeAccountSniffer

ตรวจ email จาก response ของ claude.ai โดยใช้ whitelist:

```python
WHITELIST = [
    r"^/api/auth/current_account$",   # endpoint ที่ return user ปัจจุบัน
    r"^/api/account/?$",
    r"^/(api|edge-api)/bootstrap(/[^/]+){0,2}/?$",
]
```

**ทำไมต้อง whitelist?**

claude.ai มี API หลายตัวที่ return email เช่น org member list, support email ใน config — ถ้า search ทั้งหมดจะได้ email ผิด

---

### SSE Parsing

Claude API ส่ง response เป็น Server-Sent Events (SSE):

```
data: {"type": "message_start", "message": {"usage": {"input_tokens": 234}}}
data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "สวัสดี"}}
data: {"type": "message_delta", "usage": {"output_tokens": 89}}
data: [DONE]
```

`_parse_sse_api()` วนอ่านทุกบรรทัด สะสม text และดึง token counts

---

### ระบบ Logging

ทุก API call จะถูกบันทึก 2 ที่พร้อมกัน (parallel):

```python
# 1. บันทึกในเครื่องทันที (synchronous)
_write_local(log)

# 2. ส่งไป Worker (async, ไม่บล็อก main thread)
threading.Thread(target=_send_log, args=(log,), daemon=True).start()
```

**ทำไม bypass proxy ตอนส่ง Worker?**

addon รันใน mitmproxy ซึ่งเป็น proxy เอง — ถ้าส่ง request ผ่าน system proxy จะวนกลับมาหาตัวเอง (loopback):

```python
_no_proxy_opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({})  # ← บังคับไม่ใช้ proxy
)
```

---

## อธิบาย worker/src/index.ts

Worker ทำ 3 อย่าง:

### POST /log — รับข้อมูลจาก addon

```typescript
// ตรวจ API key
if (request.headers.get('X-Api-Key') !== env.API_KEY) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
}

// บันทึกลง D1
await env.DB.prepare(`INSERT OR IGNORE INTO api_logs ...`).bind(...).run();
```

`INSERT OR IGNORE` — ป้องกัน duplicate กรณี addon ส่งซ้ำ (retry)

### GET / — Dashboard

Query ข้อมูลจาก D1 แบบ parallel แล้ว build HTML:

```typescript
const [rows, totals, byModel, byClient, byMachine, byAccount] = await Promise.all([
    env.DB.prepare(`SELECT * FROM api_logs ORDER BY ts DESC LIMIT 100`).all(),
    env.DB.prepare(`SELECT COUNT(*), SUM(input_tokens), SUM(cost_usd) ...`).first(),
    // ... etc
]);
```

Dashboard เป็น HTML ล้วน ไม่มี framework — inline CSS + inline JS เพื่อ deploy ง่าย

---

## การเพิ่มฟีเจอร์ใหม่

### เพิ่ม endpoint ที่ต้องการ monitor

ถ้าต้องการดัก endpoint ใหม่ ให้สร้าง class ใหม่:

```python
class MyNewMonitor:
    def response(self, flow: http.HTTPFlow):
        # กรองเฉพาะ endpoint ที่ต้องการ
        if "my-endpoint.com" not in flow.request.host:
            return
        if flow.request.path != "/api/chat":
            return

        # ดึงข้อมูล
        req    = json.loads(flow.request.content)
        prompt = req.get("message", "")
        model  = req.get("model", "unknown")

        # Parse response
        resp = flow.response.content.decode("utf-8", errors="replace")
        # ... แปลงตามรูปแบบ response ของ endpoint นั้น

        # สร้าง log object
        log = {
            "id":           str(uuid.uuid4()),
            "ts":           int(datetime.now().timestamp() * 1000),
            "client":       _detect_client(flow.request.headers),
            "account_email": current_email(),
            "machine_name": HOSTNAME,
            "model":        model,
            "prompt":       prompt,
            "prompt_chars": len(prompt),
            # ... ฯลฯ
        }

        _write_local(log)
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()

# ลงทะเบียน
addons.append(MyNewMonitor())
```

### เพิ่ม model ราคาใหม่

```python
_PRICE = {
    "opus":     dict(inp=15,   out=75,  cr=1.50, cw=18.75),
    "sonnet":   dict(inp=3,    out=15,  cr=0.30, cw=3.75),
    "haiku":    dict(inp=0.80, out=4,   cr=0.08, cw=1.00),
    "opus-4":   dict(inp=20,   out=100, cr=2.00, cw=25.00),  # ← เพิ่มใหม่
}
```

ฟังก์ชัน `_calc_cost()` จะตรวจชื่อ model แล้วเลือก tier เอง

### เพิ่ม column ใน Dashboard

1. เพิ่มคำสั่ง SQL ใน Worker:

```typescript
const byDay = await env.DB.prepare(`
    SELECT DATE(ts/1000, 'unixepoch') as day, COUNT(*) as calls, SUM(cost_usd) as cost
    FROM api_logs
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
`).all();
```

2. เพิ่ม HTML ใน `buildDashboard()`:

```typescript
const dailyRows = byDay.results.map(d =>
    `<tr><td>${d.day}</td><td class="r">${num(d.calls)}</td><td class="r cost">$${num(d.cost, 4)}</td></tr>`
).join('');

// เพิ่มใน HTML:
`<section>
  <h2>Daily Summary</h2>
  <table>
    <thead><tr><th>วัน</th><th class="r">Calls</th><th class="r">Cost</th></tr></thead>
    <tbody>${dailyRows}</tbody>
  </table>
</section>`
```

---

## Debug

### mitmproxy verbose mode

```bash
mitmdump -s addon.py --listen-port 8080 -vv
# -vv แสดงทุก request/response อย่างละเอียด
```

### เพิ่ม print debug ใน addon

```python
def response(self, flow: http.HTTPFlow):
    print(f"[DEBUG] {flow.request.host}{flow.request.path}")
    print(f"[DEBUG] status: {flow.response.status_code}")
    print(f"[DEBUG] content-type: {flow.response.headers.get('content-type', '')}")
```

### ดู log ในเครื่อง

```bash
# Windows PowerShell
Get-Content log\claude_2024-12-19.jsonl | Select-Object -Last 5

# macOS/Linux
tail -5 log/claude_$(date +%Y-%m-%d).jsonl | python -m json.tool
```

### ทดสอบ Worker โดยตรง

```bash
# ทดสอบ health check
curl https://your-worker.workers.dev/health

# ทดสอบ POST /log
curl -X POST https://your-worker.workers.dev/log \
  -H "X-Api-Key: MySecretKey123" \
  -H "Content-Type: application/json" \
  -d '{"id":"test-001","ts":1234567890000,"client":"api","model":"claude-3-sonnet","prompt":"ทดสอบ","input_tokens":10,"output_tokens":5,"cost_usd":0.00001}'

# ดู dashboard
curl https://your-worker.workers.dev/ | head -50
```

### Query D1 Database

```bash
# ดูทุกตาราง
wrangler d1 execute claude-monitor --remote --command ".schema"

# นับ rows
wrangler d1 execute claude-monitor --remote --command "SELECT COUNT(*) FROM api_logs"

# ค่าใช้จ่ายสัปดาห์นี้
wrangler d1 execute claude-monitor --remote --command "
SELECT 
  DATE(ts/1000, 'unixepoch') as day,
  COUNT(*) as calls,
  ROUND(SUM(cost_usd), 4) as cost_usd
FROM api_logs 
WHERE ts > (strftime('%s', 'now', '-7 days') * 1000)
GROUP BY day
ORDER BY day DESC
"
```

---

## ปัญหาที่พบบ่อยในการพัฒนา

| ปัญหา | วิธีตรวจ |
|-------|---------|
| addon โหลดไม่ได้ | `python -m py_compile proxy/addon.py` |
| Worker deploy ไม่ได้ | ตรวจ `database_id` ใน wrangler.toml, รัน `wrangler login` |
| D1 query return ว่าง | `wrangler d1 execute ... --command ".tables"` ตรวจว่าตารางมีจริง |
| Dashboard ไม่โหลด | `wrangler tail` ดู error log แบบ real-time |
| addon ไม่ดักจับ | ตรวจ `--allow-hosts`, เปิด `-vv` mode |
| log ไม่เขียน | ตรวจสิทธิ์ write ที่ directory `log/` |

---

## Performance

### กรณีใช้งานหนัก (หลายพัน calls/วัน)

**เพิ่ม index:**

```bash
wrangler d1 execute claude-monitor --remote --command "
CREATE INDEX IF NOT EXISTS idx_model_ts ON api_logs(model, ts DESC);
CREATE INDEX IF NOT EXISTS idx_client_ts ON api_logs(client, ts DESC);
"
```

**ลบ log เก่าอัตโนมัติ:**

```bash
# สร้าง cron job หรือรันด้วยมือทุกเดือน
wrangler d1 execute claude-monitor --remote --command \
  "DELETE FROM api_logs WHERE ts < (strftime('%s', 'now', '-90 days') * 1000)"
```

**เก็บแค่ preview ของ prompt:**

```python
def _log(self, client, model, prompt, parsed):
    log = {
        "prompt":       prompt[:500],   # เก็บแค่ 500 ตัวแรก
        "prompt_chars": len(prompt),     # แต่นับ chars ทั้งหมด
        # ...
    }
```

---

## ไฟล์อ้างอิง

| ไฟล์ | หน้าที่ |
|------|---------|
| [proxy/addon.py](proxy/addon.py) | mitmproxy addon หลัก |
| [proxy/config.py](proxy/config.py) | ค่าตั้งต้น (ต้องสร้างเอง) |
| [proxy/config.example.py](proxy/config.example.py) | template config |
| [worker/src/index.ts](worker/src/index.ts) | Cloudflare Worker + Dashboard |
| [worker/wrangler.toml](worker/wrangler.toml) | Cloudflare config |
