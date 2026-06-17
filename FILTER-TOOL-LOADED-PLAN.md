# Filter "Tool loaded." Entries — แผน implement

> ## 📋 ยังไม่ได้ implement (แผน) — สถานะ ณ 2026-06
> ตรวจ `proxy/addon.py` แล้ว**ยังไม่มี**โค้ดจัดการ entry `"Tool loaded."` ตามแผนนี้ เอกสารนี้เป็น **แผนที่ยังรออยู่** เก็บไว้เป็นข้อเสนอ

แผนจัดการ log entry ที่ prompt เป็น `"Tool loaded."` ซึ่ง Claude Code (CLI / VSCode)
ยิงเข้ามาตอน reload MCP tool definitions — **เป็น call จริงที่ Anthropic คิดเงิน**
ต่างจากกรณี `"quota"` ที่ตัดทิ้งได้ (ดู [FILTER-QUOTA-PROBE-PLAN.md](FILTER-QUOTA-PROBE-PLAN.md))

---

## 1. ภาพรวม

### ปัญหา

ใน [log/](log/) มี entry รูปแบบนี้เยอะ (70+ ครั้งใน 2 วัน):

```json
{
  "client": "claude-code-cli",       // หรือ "claude-code-vscode"
  "account_email": "user@softdebut.com",
  "model": "claude-opus-4-7",
  "prompt": "Tool loaded.",
  "prompt_chars": 12,
  "response_chars": 0,
  "input_tokens": 6,
  "output_tokens": 1143,             // 578 – 2,151 แล้วแต่ครั้ง
  "cache_creation_tokens": 24589,    // หลายพัน – หลายหมื่น
  "cache_read_tokens": 22591,
  "total_tokens": 48319,
  "cost_usd": 0.538                   // $0.11 – $0.54 ต่อครั้ง
}
```

### สาเหตุ

- Claude Code เปิด session ใหม่ / เพิ่ม-แก้ MCP server / reload tools → ส่ง
  user message `"Tool loaded."` เพื่อ trigger assistant ประมวลผล tool palette ใหม่
- `cache_creation_tokens` สูง = กำลังยัด tool schema เข้า prompt cache สำหรับ turn ถัดไป
- `output_tokens` หลักร้อย-หลักพัน = assistant ตอบจริง (มัก thinking + acknowledgement)

### Cost impact — สำคัญมาก ⚠️

ต่างจาก `"quota"` ($0.00001 / ครั้ง) ตัว `"Tool loaded."` ราคา **$0.11–$0.54 / ครั้ง**

| ระยะเวลา (จาก log ปัจจุบัน) | จำนวน entry | cost รวม (ประมาณ) |
|---|---|---|
| 2 วัน (2026-05-18 → 2026-05-19) | 70+ | **$15–30** |

→ ถ้า drop ตั้งแต่ proxy แบบ `"quota"` **dashboard จะแสดง cost ต่ำกว่าจริง $15-30/2วัน**
ทั้งๆ ที่ Anthropic บิลจริง

### เป้าหมาย

- ลดความรกของ "Prompts list" ใน dashboard (ไม่ให้ `"Tool loaded."` ขึ้นเต็มหน้า)
- **คง cost รวม + token รวมให้ถูกต้องตามที่ Anthropic บิลจริง**
- เก็บข้อมูลไว้ดูแยกได้ (เผื่ออยาก audit "Claude Code โหลด tool บ่อยแค่ไหน")

### ไม่ใช่เป้าหมาย

- ไม่ลบ entry ออกจาก D1
- ไม่ตัดที่ proxy (เพราะจะทำให้ aggregate cost ขาด)

---

## 2. 3 ทางเลือก เปรียบเทียบ

| | **A. Tag + Toggle** | **B. List-only filter** | **C. Drop at proxy** |
|---|---|---|---|
| Cost ที่แสดง | ถูกต้อง 100% | ถูกต้อง 100% | **ขาด $15-30/2วัน** ❌ |
| ขึ้นใน "Prompts list" | toggle เปิด/ปิด ได้ | ปิดถาวร (ไม่ขึ้น) | ไม่ขึ้น (ไม่มีใน DB) |
| ขึ้นใน aggregate (by model/client/account) | ขึ้นปกติ | ขึ้นปกติ | ไม่ขึ้น |
| งานต้องทำ | proxy + migration + worker + view | worker เปลี่ยน WHERE clause | proxy อย่างเดียว |
| ย้อนกลับยาก/ง่าย | ง่าย (ลบ flag) | ง่ายมาก (ลบ WHERE) | ยาก (ข้อมูลหายไปเลย) |
| **คำแนะนำ** | ⭐ ถ้าอยาก audit ได้ | ⭐ ถ้าไม่ต้อง audit | ❌ ไม่แนะนำ |

---

## 3. Option A — Tag + Toggle (full implementation)

ติด flag `is_tool_reload` บน entry, dashboard มี toggle เปิด/ปิด แสดงในตาราง prompts

### A.1 ฝั่ง Proxy — [proxy/addon.py](proxy/addon.py)

เพิ่ม helper detect และ inject flag เข้า log payload ทั้ง 3 monitor:

```python
def _is_tool_reload(prompt: str, client: str) -> bool:
    """
    Claude Code's MCP tool reload probe. Real assistant turn (costs money),
    but not user-initiated traffic. Tag so the dashboard can hide them from
    the prompts list without affecting cost totals.
    """
    if not client.startswith("claude-code"):
        return False
    return (prompt or "").strip() == "Tool loaded."
```

แล้วใน `_log()` ของ `ClaudeAPIMonitor` (~line 530), `ClaudeDesktopMonitor` (~line 575),
และ `ClaudeBridgeMonitor._flush()` (~line 1003) เพิ่มลงใน dict `log`:

```python
log = {
    ...,
    "cost_usd": _calc_cost(model, inp, out, cr, cw),
    "is_tool_reload": _is_tool_reload(prompt, client),
}
```

### A.2 D1 Migration — `worker/migrations/0006_tool_reload_flag.sql` (สร้างใหม่)

```sql
-- Tag tool-reload entries so the dashboard can hide them from the prompts
-- list while keeping their cost in aggregate totals.
ALTER TABLE api_logs ADD COLUMN is_tool_reload INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_api_logs_tool_reload
  ON api_logs(is_tool_reload)
  WHERE is_tool_reload = 1;

-- Backfill: catch existing rows so old data also benefits from the toggle
UPDATE api_logs
   SET is_tool_reload = 1
 WHERE prompt = 'Tool loaded.'
   AND client LIKE 'claude-code%';
```

Apply ด้วย:
```bash
cd worker
wrangler d1 migrations apply <db-name> --remote
```

### A.3 TypeScript types — [worker/src/types.ts](worker/src/types.ts)

เพิ่ม field ใน `ApiLog`:

```typescript
export interface ApiLog {
    ...
    cost_usd: number;
    is_tool_reload: number;  // 0 | 1
}
```

### A.4 Insert query — [worker/src/db/queries.ts:303](worker/src/db/queries.ts#L303)

เพิ่ม column + value ใน `insertLog`:

```typescript
await env.DB.prepare(
    `INSERT OR IGNORE INTO api_logs
       (id, ts, client, account_email, client_ip, machine_name, model, prompt, prompt_chars, response_chars,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        total_tokens, cost_usd, is_tool_reload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
).bind(
    ...
    b.cost_usd ?? 0,
    b.is_tool_reload ? 1 : 0,
)
```

### A.5 List query — [worker/src/db/queries.ts:23](worker/src/db/queries.ts#L23)

เพิ่ม filter พึ่งกับ query string (`?showToolReload=1`):

```typescript
const toolReloadClause = filters.showToolReload
    ? ''
    : `AND is_tool_reload = 0`;

env.DB.prepare(
    `SELECT * FROM api_logs ${clause} ${toolReloadClause}
     ORDER BY ts DESC ${limitClause}`
).bind(...params).all<ApiLog>()
```

**สำคัญ:** ใส่ `toolReloadClause` **เฉพาะ** query "list rows" (recentRes) เท่านั้น
ห้ามใส่ใน aggregate queries (totals / byModel / byClient / byAccount) — ไม่งั้น cost ขาด

### A.6 Filters type + parser — [worker/src/db/filters.ts](worker/src/db/filters.ts) + [worker/src/types.ts](worker/src/types.ts)

เพิ่ม:
```typescript
// types.ts
export interface Filters {
    ...
    showToolReload: boolean;
}

// filters.ts (parse จาก URL)
showToolReload: url.searchParams.get('showToolReload') === '1',
```

### A.7 UI Toggle — [worker/src/views/dashboard.ts](worker/src/views/dashboard.ts) + [worker/src/views/dashboard.client.js](worker/src/views/dashboard.client.js)

เพิ่ม checkbox/toggle ในแถบ filter ด้านบนตาราง:

```html
<label>
    <input type="checkbox" id="show-tool-reload"
           data-filter="showToolReload" value="1">
    Show tool-reload entries
</label>
```

แล้วใน client JS เพิ่ม URL param เวลา submit filter เหมือน field อื่น

### A.8 (Optional) ลบ "Tool loaded." จาก top-prompts query

ใน [worker/src/db/queries.ts](worker/src/db/queries.ts) มี `topPromptsRes` query
เพิ่ม `WHERE is_tool_reload = 0` เพื่อไม่ให้ติด top เสมอ

---

## 4. Option B — List-only filter (lightweight)

ไม่แตะ DB schema ใช้ pattern match ใน WHERE clause ของ query list อย่างเดียว

### B.1 List query — [worker/src/db/queries.ts:23](worker/src/db/queries.ts#L23)

```typescript
env.DB.prepare(
    `SELECT * FROM api_logs ${clause}
     AND NOT (prompt = 'Tool loaded.' AND client LIKE 'claude-code%')
     ORDER BY ts DESC ${limitClause}`
).bind(...params).all<ApiLog>()
```

### B.2 (Optional) top-prompts query

แก้คล้ายกัน ใน query `topPromptsRes` เพิ่ม `AND NOT (...)`

**ห้ามแตะ:** totals / byModel / byClient / byAccount queries

### ข้อจำกัด Option B

- ไม่มี toggle เปิดดูได้ตอน audit (ต้อง query DB ตรง)
- ถ้า Claude Code เปลี่ยนข้อความ "Tool loaded." → filter หลุด
- Pattern match ไม่ใช้ index → ถ้าตารางใหญ่มากๆ อาจช้า (ตอนนี้ไม่ใช่ปัญหา)

---

## 5. Option C — Drop at proxy (ไม่แนะนำ)

ถ้าอยากทำจริงๆ (ยอม cost หาย) แก้แค่ [proxy/addon.py](proxy/addon.py):

```python
def _log(self, flow, client, model, prompt, parsed):
    # WARNING: this hides $0.10-$0.50/call from cost reports. Use Option A or B
    # instead to keep aggregate cost correct.
    if (client.startswith("claude-code")
        and (prompt or "").strip() == "Tool loaded."):
        return
    ...
```

ใส่ทั้ง 3 monitor (`ClaudeAPIMonitor._log`, `ClaudeDesktopMonitor.response`,
`ClaudeBridgeMonitor._flush`)

**อย่าใช้ option นี้ ยกเว้น** ยืนยันแล้วว่ายอมรับว่ารายงาน cost จะต่ำกว่า invoice จริง

---

## 6. ลำดับขั้นตอน implement (Option A เต็ม)

1. [ ] เขียน migration `0006_tool_reload_flag.sql`
2. [ ] Apply migration บน D1 remote (`wrangler d1 migrations apply --remote`)
3. [ ] เพิ่ม field `is_tool_reload` ใน `ApiLog` type
4. [ ] แก้ `insertLog` รับ column ใหม่
5. [ ] เพิ่ม `_is_tool_reload()` helper ใน [proxy/addon.py](proxy/addon.py)
6. [ ] inject `is_tool_reload` ใน `log` dict ของ 3 monitor
7. [ ] Restart mitmdump → verify entry ใหม่มี field ถูกต้อง
8. [ ] เพิ่ม `showToolReload` ใน `Filters` type + parser
9. [ ] เพิ่ม `toolReloadClause` ใน list query (เฉพาะ recentRes!)
10. [ ] เพิ่ม checkbox UI ใน dashboard
11. [ ] Deploy worker → ทดสอบ toggle ทำงาน
12. [ ] Verify: aggregate cost ก่อน/หลัง deploy ต้องเท่าเดิม

---

## 7. ลำดับขั้นตอน implement (Option B เร็ว)

1. [ ] แก้ list query ใน [worker/src/db/queries.ts:23](worker/src/db/queries.ts#L23)
   เพิ่ม `AND NOT (prompt = 'Tool loaded.' AND client LIKE 'claude-code%')`
2. [ ] (Optional) แก้ top-prompts query เช่นกัน
3. [ ] Deploy worker
4. [ ] Verify: totals/aggregate ยังเท่าเดิม, list ไม่มี "Tool loaded." แล้ว

---

## 8. ทางเลือกย้อนกลับ (rollback)

### Option A rollback

- ลบ checkbox + `showToolReload` field — UI กลับมาแสดงทุก entry
- ไม่ต้อง rollback migration (field อยู่เฉยๆ ไม่กระทบ)

### Option B rollback

- ลบ `AND NOT (...)` clause ออกจาก query
- Redeploy worker

### Option C rollback

- ลบ early-return ออกจาก `_log()`
- Restart mitmdump
- **หมายเหตุ:** entry ที่หายไประหว่าง option C ใช้งาน → กู้ไม่ได้

---

## 9. ข้อมูลอ้างอิง — pattern ที่เห็นจริง

| field | ค่า |
|---|---|
| client | `claude-code-cli` หรือ `claude-code-vscode` |
| prompt | `"Tool loaded."` (12 chars) |
| input_tokens | 6 (เกือบทุกครั้ง) |
| output_tokens | 578 – 2,151 |
| cache_creation_tokens | 658 – 24,589 |
| cache_read_tokens | 22,591 – 66,643 (cache hit เก่า) |
| cost_usd | $0.11 – $0.54 |
| response_chars | มัก 0 (thinking only) |

ไม่เคยเจอ user พิมพ์ `"Tool loaded."` เอง — string นี้เกิดจาก Claude Code internal เท่านั้น

---

## 10. Checklist สำหรับเรียกใช้ในอนาคต

> "ทำ filter `Tool loaded.` ตาม [FILTER-TOOL-LOADED-PLAN.md](FILTER-TOOL-LOADED-PLAN.md) ใช้ Option B"

- [ ] ระบุ option (A / B / C) — default แนะนำ B ก่อน ถ้าต้อง audit ใช้ A
- [ ] ทำตามลำดับใน section 6 หรือ 7 ตาม option
- [ ] หลัง deploy verify ว่า aggregate cost ก่อน/หลัง = เท่าเดิม
