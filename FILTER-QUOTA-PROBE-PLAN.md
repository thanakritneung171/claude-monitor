# Filter Quota Probe — แผน implement

> ## 📋 ยังไม่ได้ implement (แผน) — สถานะ ณ 2026-06
> ตรวจ `proxy/addon.py` แล้ว**ยังไม่มี**โค้ดกรอง "quota" probe ตามแผนนี้ เอกสารนี้เป็น **แผนที่ยังรออยู่** เก็บไว้เป็นข้อเสนอ ถ้าจะทำให้ทำตามนี้

แผนกรองไม่ให้ proxy เก็บ log "quota" probe จาก Dify (และเครื่องมือ LLM gateway อื่นที่ทำคล้ายกัน)
ที่ยิงเข้ามาเพื่อ validate API key เท่านั้น ไม่ใช่ traffic ของ user จริง

---

## 1. ภาพรวม

### ปัญหา

ใน [log/](log/) มี entry รูปแบบนี้เยอะมาก (32+ ครั้งใน 2 วัน):

```json
{
  "client": "api",
  "machine_name": "dify",
  "model": "claude-haiku-4-5-20251001",
  "prompt": "quota",
  "prompt_chars": 5,
  "response_chars": 1,
  "input_tokens": 8,
  "output_tokens": 1,
  "cache_creation_tokens": 0,
  "cache_read_tokens": 0,
  "total_tokens": 9,
  "cost_usd": 1.04e-05
}
```

### สาเหตุ

- **Dify** (และ LLM gateway อื่นๆ) ส่ง `POST /v1/messages` ด้วย body ขั้นต่ำสุด:
  - `model = claude-haiku-4-5-20251001` (รุ่นถูกที่สุด)
  - `messages = [{role:"user", content:"quota"}]`
  - `max_tokens = 1`
- ใช้สำหรับ:
  - ตอน save API key ของ provider → validate ว่า key ใช้ได้
  - Background health check ตามรอบ
  - เปิด workflow ที่ผูก Anthropic provider
- ใช้ response แค่เพื่อดู status code + อ่าน `anthropic-ratelimit-*` headers
  ไม่ได้สนใจเนื้อ output

### ทำไมต้องกรอง

- ไม่ใช่ user traffic จริง → ทำให้ dashboard รก / สถิติเพี้ยน
- จำนวนเยอะมาก (~16/วัน) → กิน row ใน D1 ฟรีๆ
- Cost ต่อครั้ง ~$0.00001 รวมทั้งหมด < $0.001 → **ตัดทิ้งได้ปลอดภัย ไม่กระทบรายงาน cost**

### ไม่ใช่เป้าหมาย

- ไม่กรอง `"Tool loaded."` ที่ Claude Code ยิงตอน reload tools (อันนั้นเป็น call จริง
  ที่ Anthropic คิดเงิน $0.10-$0.50/ครั้ง — ตัดทิ้งจะทำให้ dashboard ขาด cost จริง)
- ไม่แตะ flow ของ request — mitmproxy ยัง forward ปกติ ตัด **เฉพาะการเก็บ log**

---

## 2. จุดที่ต้องแก้

ไฟล์เดียว: [proxy/addon.py](proxy/addon.py)

| location | บทบาท | ต้องเพิ่ม early-return |
|---|---|---|
| [`ClaudeAPIMonitor._log()`](proxy/addon.py#L530) | log path สำหรับ `api.anthropic.com/v1/messages` (client="api") | ✅ ที่นี่อย่างเดียวพอ |
| `ClaudeDesktopMonitor.response()` | claude.ai/completion (Desktop) | ❌ ไม่ต้อง — Dify ไม่ยิง claude.ai |
| `ClaudeBridgeMonitor._flush()` | bridge.claudeusercontent.com (Claude Code OAuth) | ❌ ไม่ต้อง — Dify ไม่ใช่ bridge user |

quota probe ทุกตัวเข้ามาทาง `ClaudeAPIMonitor` เท่านั้น (raw API key หรือ Bearer token)
เพราะ Dify ใช้ direct API ไม่ผ่าน Claude Desktop / Claude Code

---

## 3. ทางเลือก filter

### Option A — Literal match (แนะนำ)

ตรงไป ตรงมา จับเฉพาะ pattern ที่เห็นจริงในปัจจุบัน

```python
def _log(self, flow, client, model, prompt, parsed):
    # Skip credential-validation probes (Dify et al.). Pattern: client=api,
    # prompt literally "quota", output capped at 1 token by max_tokens=1.
    # Real user input "quota" from Claude Code would have output_tokens > 1.
    if (client == "api"
        and (prompt or "").strip().lower() == "quota"
        and parsed.get("output_tokens", 0) <= 1):
        return

    inp = parsed["input_tokens"]
    ...
```

- **ข้อดี:** จับเฉพาะ Dify probe จริงๆ ไม่ false-positive
- **ข้อเสีย:** ถ้า Dify เปลี่ยน probe text (เช่นใช้ `"ping"`/`"test"`) จะหลุดมาเก็บอีก

### Option B — Heuristic (กรองกว้างกว่า)

จับ "probe-like call" ทุกแบบ ไม่ผูกกับ literal "quota"

```python
def _log(self, flow, client, model, prompt, parsed):
    # Skip API-key validation probes. Heuristic: tiny input + capped output
    # via max_tokens=1 + very short prompt is never real user traffic.
    if (client == "api"
        and parsed.get("output_tokens", 0) <= 1
        and parsed.get("input_tokens", 0) < 20
        and len((prompt or "").strip()) <= 10):
        return
    ...
```

- **ข้อดี:** กันได้ครอบคลุมถ้า Dify / tool อื่นเปลี่ยน probe text
- **ข้อเสีย:** เสี่ยง false-positive (เช่น user พิมพ์ `"ok"` แล้ว response สั้นมาก) —
  แต่โอกาสน้อย เพราะ user ไม่ได้ตั้ง `max_tokens=1` เอง

### Option C — Combo (ปลอดภัยสุด)

literal `"quota"` + heuristic fallback แยก log

```python
def _log(self, flow, client, model, prompt, parsed):
    if client == "api" and parsed.get("output_tokens", 0) <= 1:
        p = (prompt or "").strip().lower()
        if p == "quota":
            return  # known Dify probe — drop silently
        if parsed.get("input_tokens", 0) < 20 and len(p) <= 10:
            print(f"[claude-api] SKIP probe-like | prompt={p!r}")
            return
    ...
```

- **ข้อดี:** เลิก spam dashboard + เห็น probe pattern ใหม่ที่อาจเกิดขึ้นใน console
- **ข้อเสีย:** logic เยอะกว่าเล็กน้อย

**คำแนะนำ:** เริ่มที่ **Option A** ก่อน ถ้าเจอ probe pattern อื่นเพิ่มค่อยขยับไป C

---

## 4. ลำดับขั้นตอน implement

1. แก้ [`proxy/addon.py:530`](proxy/addon.py#L530) เพิ่ม early-return ตาม option ที่เลือก
2. (Optional) เพิ่ม print log บอกว่า skip ไปกี่ครั้ง — เผื่อ debug ภายหลัง
3. Restart mitmdump → `make proxy-restart` (หรือ command ที่ใช้ deploy proxy)
4. รอ Dify ยิง probe รอบถัดไป → ดู [log/](log/) วันนั้น ว่ามี `prompt:"quota"` ใหม่ขึ้นมาไหม
5. ตรวจ Worker dashboard — ไม่ควรมี row `prompt="quota" client="api"` ใหม่หลัง restart

**ไม่ต้องแก้:**
- Worker schema — entries เก่ายังอยู่ใน D1 ตามเดิม
- View / dashboard code — เพราะ entry ใหม่จะไม่ส่งมาเลย

---

## 5. ทางเลือกย้อนกลับ (rollback)

ถ้าพบว่า filter ตัด user traffic จริงโดยพลาด:

1. คอมเมนต์ block `if (client == "api" ...): return` ออก
2. Restart mitmdump
3. ดู log ใหม่ว่ามี call ที่ "หาย" ไปแบบไหน → ปรับ heuristic

ไม่จำเป็นต้องลบ entry quota เก่าออกจาก D1 — ถ้าอยากเคลียร์ ใช้ route
[`worker/src/routes/clear-data.ts`](worker/src/routes/clear-data.ts) หรือ query ตรง:

```sql
DELETE FROM logs WHERE prompt = 'quota' AND client = 'api' AND output_tokens <= 1;
```

---

## 6. ข้อมูลอ้างอิง — pattern ที่เห็นจริง

จาก [log/claude_2026-05-18.jsonl](log/claude_2026-05-18.jsonl) + [log/claude_2026-05-19.jsonl](log/claude_2026-05-19.jsonl):

- ทุก entry มี `client = "api"`, `machine_name = "dify"`
- `model = claude-haiku-4-5-20251001` (consistent)
- `input_tokens = 8`, `output_tokens = 1` (consistent — `max_tokens=1` ฝั่ง client)
- `prompt = "quota"`, `prompt_chars = 5`
- `response_chars = 1` (เช่น `"."` หรือ token เดียว)
- `cost_usd ≈ 1.04e-05` ต่อครั้ง

บาง entry มี `account_email` ถูก resolve (`suphawit.pha@softdebut.com`,
`somkiat.k@softdebut.com`, etc.) — เพราะ JWT decode จาก Bearer token
ของ Claude account ที่ใช้ใน Dify config ดึงมาได้ ก็ไม่ใช่ปัญหา filter

---

## 7. checklist สั้นสำหรับเรียกใช้ในอนาคต

> "ทำ filter `quota` ตาม [FILTER-QUOTA-PROBE-PLAN.md](FILTER-QUOTA-PROBE-PLAN.md) ใช้ Option A"

- [ ] เปิด [proxy/addon.py](proxy/addon.py) ไปที่ `ClaudeAPIMonitor._log()` (~line 530)
- [ ] เพิ่ม block 4 บรรทัด early-return ต้นฟังก์ชัน (ก่อน `inp = parsed["input_tokens"]`)
- [ ] Restart mitmdump
- [ ] Verify ใน log ของวันใหม่ว่าไม่มี `prompt:"quota"` entry แล้ว
