# SDB AI Insight — ระบบติดตาม Prompt ของ Claude (Context สำหรับ NotebookLM)

> เอกสารนี้เป็น **source context** สำหรับป้อนเข้า NotebookLM
> ครอบคลุม 4 หัวข้อหลัก: (1) การทำงานของระบบ (2) การเก็บ log prompt (3) เงื่อนไขการได้ email ของผู้ใช้จากแต่ละ platform (4) การเก็บข้อมูลในหน้า New Identity
> เนื้อหาทุกส่วนอ้างอิงจากโค้ดจริง: `proxy/addon.py`, `worker/src/routes/log.ts`, `worker/src/db/queries.ts`, `worker/migrations/0010_email_identity.sql`, `worker/src/views/new-identity.ts`
> หลักการกลางของระบบ: **"อ่านตัวตนจาก token ที่ request พกมาเอง แทนการเดาตัวตนจาก IP"** → ระบุตัวตนด้วย email ทำให้ปลอดภัยเมื่อผู้ใช้เปลี่ยน IP ผ่าน VPN (VPN-safe)

---

## 0. บริบทและเป้าหมายของระบบ

SDB AI Insight (ชื่อโปรเจกต์: claude-monitor) คือระบบติดตามการใช้งาน Claude ภายในองค์กร Softdebut เป้าหมายคือบันทึกทุก prompt ที่พนักงานส่งหา Claude ไม่ว่าจะผ่านช่องทางใด แล้วระบุว่า prompt นั้นเป็นของพนักงานคนไหน (ด้วย email) พร้อมเก็บข้อมูลการใช้งาน เช่น โมเดลที่ใช้ จำนวน token และค่าใช้จ่าย (cost) เพื่อนำมาวิเคราะห์บน Dashboard

**ปัญหาเดิมที่นำมาสู่การออกแบบใหม่:** ระบบรุ่นก่อนใช้ **IP address เป็นแกนระบุตัวตน** (ระบบ 4 ชั้น L1–L4 + ตาราง `ip_identity` + กลไก "ยืม email ตาม IP") เมื่อพนักงานใช้ VPN ที่เปลี่ยน IP ตลอดเวลา ทำให้ระบบ attribute prompt ผิดคน เช่น User A เคยใช้ IP X วันนี้ User B ได้ IP X ผ่าน VPN ระบบก็ยืม email ของ A ไปแปะให้ log ของ B โดยอัตโนมัติ

**แนวคิดใหม่:** ทุก prompt request พก token ระบุตัวตนของตัวเองมาด้วยอยู่แล้ว จึงเปลี่ยนมาดึง email จาก token ที่ติดมากับ request โดยตรง แทนการอนุมานจาก IP ส่วน `client_ip` ยังเก็บไว้แต่ใช้เพื่อ **audit เท่านั้น ไม่ใช้ระบุตัวตน**

---

## 1. การทำงานของระบบ (Architecture & Flow)

### 1.1 สถาปัตยกรรม 3 ชั้น

ระบบประกอบด้วย 3 ชั้นที่ทำงานต่อกันเป็นสายพานข้อมูล:

1. **Client (โปรแกรมฝั่งผู้ใช้)** — โปรแกรมที่พนักงานใช้คุยกับ Claude ได้แก่
   - Claude Code CLI (รันใน terminal)
   - Claude Code บน VSCode extension
   - Claude Desktop app (รวมถึงแท็บ "Code" และ Cowork ในตัว)
   - claude.ai บนเว็บเบราว์เซอร์ (โหมด chat)

2. **Proxy (mitmproxy + `addon.py`)** — ตัวกลางที่ดักทุกการเชื่อมต่อ HTTPS ที่วิ่งไปยัง `anthropic.com` และ `claude.ai` ทำหน้าที่: แกะ prompt ของผู้ใช้, แกะคำตอบของ Claude, นับ token, คำนวณ cost และ **ระบุ email เจ้าของ request** รันด้วยคำสั่ง `mitmdump -s addon.py --listen-port 8080`

3. **Cloudflare Worker + D1 Database** — รับ log จาก proxy ผ่าน HTTP POST `/log` แล้วเก็บลงฐานข้อมูล D1 (SQLite) และแสดงผลผ่านหน้า Dashboard

### 1.2 เส้นทางข้อมูล (Data Flow)

```
Client → Proxy (intercept) → [เขียนไฟล์ local JSONL] + [POST ไป Worker] → D1 Database → Dashboard
```

proxy เขียน log ลง 2 ที่พร้อมกัน: ไฟล์ local และส่งเข้า Worker แบบ **fire-and-forget** (ยิงผ่าน thread แยก ไม่หน่วงการตอบสนองของผู้ใช้)

### 1.3 Pipeline การประมวลผล 1 prompt (5 ขั้น)

1. **Intercept** — addon ดัก request/response ของ endpoint เป้าหมาย 3 จุด:
   - `api.anthropic.com/v1/messages` (API key / Claude Code)
   - `claude.ai/api/organizations/.../chat_conversations/.../completion` (Claude Desktop / web chat)
   - `bridge.claudeusercontent.com` WebSocket (Claude Code OAuth login)

2. **Extract** — แกะ prompt จริงที่ผู้ใช้พิมพ์ (ฟังก์ชัน `_extract_prompt_api` / `_extract_prompt_desktop`) โดยข้าม block `<system-reminder>` ที่ระบบแทรกเข้ามา แล้ว parse คำตอบจาก SSE stream นับ token (input/output/cache) และคำนวณ cost

3. **Resolve identity** — หา `account_email` ของ request นั้นจาก token ที่ติดมา (รายละเอียดในหัวข้อ 3) **โดยไม่ใช้ IP**

4. **Filter** — ถ้า email ที่ resolve ได้ไม่มี substring `@softdebut` (ค่าเริ่มต้นของ `EMAIL_FILTER_SUBSTRING`) จะ **drop log ทิ้ง** เพื่อเก็บเฉพาะคนในองค์กร ฟังก์ชัน `_should_log()` — ถ้า resolve email ไม่ได้เลยก็ถูก drop เช่นกัน (ไม่เดาจาก IP อีกต่อไป)

5. **Log** — เขียน 1 บรรทัด JSON ลงไฟล์ local และยิง POST เข้า Worker

### 1.4 รายการ addon (mitmproxy addons) และหน้าที่

| Addon | หน้าที่ |
|---|---|
| `IdentityDebug` | (ชั่วคราว) เขียน `identity_debug.jsonl` 1 บรรทัดต่อ request เพื่อ debug ว่าทำไม email ไม่ resolve — ดู auth scheme, token hash, JWT claims, account_uuid |
| `ClaudeConnectionLogger` | log SNI hostname ของทุก TLS connection ที่ client พยายามต่อ (รวม host ที่ passthrough) |
| `ToolSchemaFixer` | แก้ tool `input_schema` ที่มี `oneOf/allOf/anyOf` ระดับ top-level (Anthropic API ปฏิเสธ) ให้เป็น object ที่ผ่านได้ |
| `ClaudeAccountSniffer` | ตรวจจับ email ของผู้ใช้ปัจจุบันจาก response ของ claude.ai แล้วผูกกับ session cookie |
| `ClaudeCodeMetricsMonitor` | ดัก `/api/claude_code/metrics` เก็บ OS/arch/version + account_id/org_id + สร้าง map uuid→email และ token→email (keyed ด้วย email) |
| `ClaudeAPIMonitor` | ดัก `api.anthropic.com/v1/messages` (API key / Claude Code CLI & VSCode) — log prompt และดึง email จาก JWT |
| `ClaudeDesktopMonitor` | ดัก claude.ai chat completion (Desktop app / browser) — log prompt |
| `ClaudeDesktopDiscovery` | log POST อื่นๆ ของ claude.ai เพื่อ debug |
| `ClaudeBridgeMonitor` | parse WebSocket ของ `bridge.claudeusercontent.com` (Claude Code OAuth) — log prompt + ดึง email จาก connect handshake |
| `ClaudeBridgeDiscovery` | log WS frame ที่ยังไม่รู้จักเพื่อเรียนรู้ protocol |

> หมายเหตุ: เคยมี `ClaudeSegmentMonitor` (จับ anonymousId ตาม IP) แต่ถูก **ถอดออกแล้ว** เพราะ host ของ Segment ไม่มี session cookie จึง correlate กับ chat session ไม่ได้ ทำให้ฟิลด์ `anon_id` กลายเป็น vestigial (เหลือไว้ในตารางแต่แทบไม่มีค่า)

### 1.5 การคำนวณ Cost

คำนวณจากราคา (USD ต่อ 1 ล้าน token) แยกตาม tier ของโมเดล (ฟังก์ชัน `_calc_cost`):

| Tier | input | output | cache read | cache write |
|---|---|---|---|---|
| opus | 15 | 75 | 1.50 | 18.75 |
| sonnet | 3 | 15 | 0.30 | 3.75 |
| haiku | 0.80 | 4 | 0.08 | 1.00 |

สูตร: `(input×ราคา + output×ราคา + cache_read×ราคา + cache_write×ราคา) / 1,000,000`

---

## 2. การเก็บ Log Prompt

### 2.1 เก็บที่ไหน (2 ที่พร้อมกัน)

1. **Local** — ไฟล์ `log/claude_YYYY-MM-DD.jsonl` (แยกไฟล์ตามวัน, 1 บรรทัด = 1 call, รูปแบบ JSON Lines) เขียนด้วยฟังก์ชัน `_write_local()`
2. **Cloud** — Cloudflare D1 ตาราง `api_logs` ส่งผ่าน HTTP POST `/log` พร้อม header `X-Api-Key` เพื่อ auth (ฟังก์ชัน `_send_log()` ฝั่ง proxy, `handleLog()` ฝั่ง Worker)

### 2.2 ฟิลด์ที่เก็บต่อ 1 record

| ฟิลด์ | ความหมาย |
|---|---|
| `id` | UUID ของ record (สุ่มใหม่ทุก call) |
| `ts` | timestamp (epoch millis) |
| `client` | ชนิดโปรแกรม เช่น `claude-code-cli`, `claude-code-vscode`, `claude-desktop`, `claude-desktop-code`, `claude-desktop-cowork`, `api` |
| `account_email` | **email เจ้าของ prompt** (แกนระบุตัวตน) |
| `client_ip` / `machine_name` | IP ต้นทาง — **เก็บเพื่อ audit เท่านั้น ไม่ใช้ระบุตัวตน** |
| `model` | โมเดลที่ใช้ เช่น `claude-sonnet-4-6`, `claude-opus-4-8`, `claude-haiku-4-5` |
| `prompt` | ข้อความ prompt จริงของผู้ใช้ |
| `prompt_chars` / `response_chars` | จำนวนตัวอักษรของ prompt / คำตอบ |
| `input_tokens`, `output_tokens` | token เข้า/ออก |
| `cache_creation_tokens`, `cache_read_tokens` | token cache เขียน/อ่าน |
| `total_tokens` | ผลรวม token ทั้งหมด |
| `cost_usd` | ค่าใช้จ่ายโดยประมาณ (USD) |
| device info | `app_version`, `os_type`, `os_version`, `host_arch`, `terminal`, `device_id`, `mac_address` |
| account info | `account_id`, `org_id` |

> device info และ account info ถูกเติมตอนเขียน log ผ่าน `**_device_info(email)` ซึ่งดึงจาก cache ที่ keyed ด้วย email (ไม่ใช่ IP)

### 2.3 ฝั่ง Worker เมื่อรับ log (`handleLog`)

1. ตรวจ `X-Api-Key` ให้ตรงกับ ingest key (ถ้าไม่ตรง → 401)
2. `insertLog()` — บันทึกลงตาราง `api_logs` เสมอ (client_ip เก็บเป็น audit)
3. ถ้า log มี `account_email` จริง → เรียก `upsertEmailIdentity()` เพื่ออัปเดตทะเบียนตัวตน canonical (รายละเอียดหัวข้อ 4)

### 2.4 ไฟล์ log อื่นๆ ใน proxy (สำหรับ debug/discovery)

- `claude_desktop_discovery.jsonl` — POST อื่นๆ ของ claude.ai
- `claude_bridge_discovery.jsonl` — WS frame ที่ยังไม่รู้จัก
- `claude_connections.jsonl` — SNI ของทุก connection
- `identity_debug.jsonl` — debug การ resolve identity ต่อ request
- `schema_fixes.jsonl` — log การแก้ tool schema
- `identity_cache.json` — persistent cache ของ identity (ดูหัวข้อ 3.6)

### 2.5 ตัวอย่าง Log Record จริง 1 บรรทัด (จาก log วันนี้)

ตัวอย่างจริงจากไฟล์ `log/claude_2026-06-12.jsonl` (1 บรรทัด = 1 call):

```json
{"id": "fa799ecf-ae82-4198-aedd-61a4876c18da", "ts": 1781245574963, "client": "claude-code-cli", "account_email": "jakrapan.j@softdebut.com", "client_ip": "10.27.0.25", "machine_name": "10.27.0.25", "model": "claude-opus-4-8", "prompt": "เปลี่ยนจากเช็คตาม id เป็น RequestNo แทน", "prompt_chars": 39, "response_chars": 40, "input_tokens": 2, "output_tokens": 450, "cache_creation_tokens": 0, "cache_read_tokens": 194244, "total_tokens": 194696, "cost_usd": 0.325146, "app_version": "1.12603.1", "os_type": "windows", "os_version": "10.0.26200", "host_arch": "amd64", "terminal": "non-interactive", "device_id": "a223de65-afee-4a5d-93ef-aacb1319eaeb", "mac_address": "", "account_id": "user_01M2GB8qzXLVYVeH1HgetUR8", "org_id": "909caccf-287d-45c6-8240-47b7d5293b31"}
```

อธิบายทีละฟิลด์:

| ฟิลด์ | ค่าในตัวอย่าง | ความหมาย |
|---|---|---|
| `id` | `fa799ecf-…` | UUID ของ call นี้ |
| `ts` | `1781245574963` | เวลา (epoch ms) = 12 มิ.ย. 2026 |
| `client` | `claude-code-cli` | ส่งจาก Claude Code CLI |
| `account_email` | `jakrapan.j@softdebut.com` | **resolve ได้ผ่านช่องทางที่ 2** (account_uuid → email จาก metrics) เพราะ CLI ใช้ raw sk-key |
| `client_ip` / `machine_name` | `10.27.0.25` | IP ต้นทาง — audit เท่านั้น |
| `model` | `claude-opus-4-8` | ใช้โมเดล Opus |
| `prompt` | `เปลี่ยนจากเช็คตาม id เป็น RequestNo แทน` | prompt จริงของผู้ใช้ |
| `prompt_chars` / `response_chars` | `39` / `40` | ความยาว prompt / คำตอบ |
| `input_tokens` | `2` | token เข้า (น้อยเพราะใช้ cache) |
| `output_tokens` | `450` | token ออก |
| `cache_creation_tokens` | `0` | ไม่ได้สร้าง cache รอบนี้ |
| `cache_read_tokens` | `194244` | อ่านจาก cache เกือบ 2 แสน token (context เดิม) |
| `total_tokens` | `194696` | รวมทั้งหมด |
| `cost_usd` | `0.325146` | ค่าใช้จ่าย ≈ $0.33 (Opus ราคาสูง + cache read เยอะ) |
| `app_version` | `1.12603.1` | เวอร์ชัน Claude Code |
| `os_type` / `os_version` | `windows` / `10.0.26200` | ระบบปฏิบัติการ (จาก metrics) |
| `host_arch` | `amd64` | สถาปัตยกรรม CPU |
| `terminal` | `non-interactive` | ชนิด terminal |
| `device_id` | `a223de65-…` | = account_uuid (ตั้งจาก metrics) |
| `mac_address` | `""` | ว่างเสมอ — Claude Code ไม่ส่ง MAC |
| `account_id` | `user_01M2GB8…` | account id ของ Anthropic |
| `org_id` | `909caccf-…` | organization id (เดียวกันทั้งองค์กร) |

> record นี้สาธิตช่องทางที่ 2 ได้ชัด: client เป็น `claude-code-cli` (ใช้ raw sk-key ที่ไม่มี email ใน token) แต่ระบบยัง resolve เป็น `jakrapan.j@softdebut.com` ได้ — เพราะ metrics endpoint เคยสร้าง map `account_uuid → email` ไว้แล้ว และ device/account fields (os, version, account_id, org_id) ก็ถูกเติมเข้ามาจาก cache ที่ keyed ด้วย email

### 2.6 เปรียบเทียบ Record ข้ามช่องทาง

นอกจาก record ของ Claude Code CLI (ช่องทางที่ 2) ใน §2.5 ด้านล่างคือ record จริงจากช่องทางอื่นที่เก็บได้จริงในวันเดียวกัน:

**(A) Cowork — resolve email ผ่าน Bearer JWT (ช่องทางที่ 1)**

```json
{"id": "f750a790-e571-4355-938a-4bd7b8097f37", "ts": 1781249145770, "client": "claude-desktop-cowork", "account_email": "teeraphat.w@softdebut.com", "client_ip": "10.27.0.6", "machine_name": "10.27.0.6", "model": "claude-sonnet-4-6", "prompt": "hello my name Ice", "prompt_chars": 17, "response_chars": 80, "input_tokens": 3, "output_tokens": 24, "cache_creation_tokens": 10816, "cache_read_tokens": 23292, "total_tokens": 34135, "cost_usd": 0.0479166, "app_version": "", "os_type": "", "os_version": "", "host_arch": "", "terminal": "", "device_id": "", "mac_address": "", "account_id": "", "org_id": ""}
```

**(B) API/VSCode — resolve email ผ่าน account_uuid/token + มี device info ครบ**

```json
{"id": "754aee28-abaa-49f8-97eb-730bddbbde5d", "ts": 1781256682586, "client": "api", "account_email": "suriya.s@softdebut.com", "client_ip": "10.27.0.22", "machine_name": "10.27.0.22", "model": "claude-haiku-4-5-20251001", "prompt": "<session>\nแก้ไข error page request_tracking\n</session>", "prompt_chars": 54, "response_chars": 44, "input_tokens": 445, "output_tokens": 14, "cache_creation_tokens": 0, "cache_read_tokens": 0, "total_tokens": 459, "cost_usd": 0.000412, "app_version": "2.1.145", "os_type": "windows", "os_version": "10.0.26200", "host_arch": "amd64", "terminal": "vscode", "device_id": "29373217-565e-4c07-b101-a0981fa29e39", "mac_address": "", "account_id": "user_0166C1RiW6HPAfb181EApPGt", "org_id": "909caccf-287d-45c6-8240-47b7d5293b31"}
```

**ตารางเทียบ 3 record:**

| ฟิลด์ | §2.5 CLI (ช่องทาง 2) | (A) Cowork (ช่องทาง 1: JWT) | (B) API/VSCode |
|---|---|---|---|
| `client` | `claude-code-cli` | `claude-desktop-cowork` | `api` (terminal=vscode) |
| `account_email` | jakrapan.j | teeraphat.w | suriya.s |
| วิธี resolve email | account_uuid → metrics map | **email claim ใน JWT โดยตรง** | account_uuid/token map |
| `model` | opus-4-8 | sonnet-4-6 | haiku-4-5 |
| device info (os/arch/ver) | ✅ ครบ | ❌ **ว่างทั้งหมด** | ✅ ครบ |
| `account_id` / `org_id` | ✅ มี | ❌ ว่าง | ✅ มี |

**ข้อสังเกตสำคัญจากการเทียบ:**
- record **Cowork (A)** resolve email ได้ (จาก JWT) แต่ **device/account fields ว่างหมด** — เพราะ Cowork/Desktop ส่ง prompt ผ่าน `/v1/messages` ที่มี JWT พา email มาเลย **แต่ไม่ได้ยิง `/api/claude_code/metrics`** ระบบจึงไม่มีข้อมูล OS/version/account_id มาเติม
- record **CLI (§2.5)** และ **API/VSCode (B)** มี device info ครบ เพราะ client เหล่านี้ยิง metrics → cache ถูกเติม
- บทเรียน: **email resolve ได้หรือไม่ ≠ device info ครบหรือไม่** เป็นคนละกลไก (email มาจาก token/uuid/cookie ของ request ส่วน device info มาจาก metrics)

**หมายเหตุข้อมูลที่ยังไม่มีตัวอย่าง record (ตามความจริงของ log):**
- **claude.ai chat (`claude-desktop`, ช่องทางที่ 3)** — ในช่วงเก็บ log ไม่มีผู้ใช้ผ่าน claude.ai web/desktop chat จึงยังไม่มี record จริง การ resolve email ของช่องทางนี้เกิดที่ฝั่ง response ของ `current_account`/`bootstrap` ซึ่ง `ClaudeAccountSniffer` consume ไปเลย ไม่ตกค้างในไฟล์ discovery
- **Bridge (ช่องทางที่ 4)** — frame `connect` ที่พา `account.email_address` ถูก `ClaudeBridgeMonitor` จัดการโดยตรง และใน log record สุดท้าย client ถูก map เป็น `claude-code-cli`/`claude-code-vscode` ทำให้แยกจาก API path ไม่ได้ด้วยตัว record เอง (schema เหมือนกันทุกฟิลด์)

---

## 3. เงื่อนไขการได้ Email ของผู้ใช้ จากแต่ละ Platform

หัวใจของระบบคือ ฟังก์ชัน `current_email(flow)` ที่ resolve email ของ request **โดยไม่ใช้ IP** ด้วยลำดับความสำคัญ 4 ชั้น:

```
1) JWT บน request เอง        → _jwt_email()
2) account_uuid ใน metadata  → _EMAIL_BY_UUID[uuid]   (Claude Code, ใช้ได้แม้เป็น raw sk-key)
3) OAuth token → email map   → _EMAIL_BY_TOKEN[token]  (เติมจาก metrics)
4) session cookie → email    → _EMAIL_BY_SESSION[hash] (claude.ai chat)
```

ตัวแปร cache หลักที่เกี่ยวข้อง (ทั้งหมด keyed ด้วย email หรือ token ไม่ใช่ IP):
- `_ACCOUNT_BY_EMAIL` : email → {name, uuid, account_id, org_id}
- `_DEVICE_BY_EMAIL` : email → {app_version, os_type, os_version, host_arch, terminal, device_id, mac_address}
- `_EMAIL_BY_SESSION` : sha256(sessionKey cookie) → email
- `_EMAIL_BY_TOKEN` : sha256(OAuth Bearer token) → email
- `_EMAIL_BY_UUID` : account_uuid → email (**ลิงก์หลักของ Claude Code** ทำงานแม้ใช้ raw sk-key)

### 3.1 ช่องทางที่ 1 — Bearer JWT (`api.anthropic.com/v1/messages`)

- **ใช้กับ:** client ที่ login แบบ subscription แล้ว token เป็น JWT ที่มี `email` claim
- **กลไก:** ฟังก์ชัน `_jwt_email()` ถอด payload กลางของ JWT (ส่วนที่ 2 คั่นด้วยจุด) แบบ base64 โดย**ไม่ verify signature** แล้วอ่านฟิลด์ `email` หรือ `email_address`
- **เงื่อนไขข้าม:** ถ้า token ขึ้นต้นด้วย `sk-` แสดงว่าเป็น raw API key ไม่ใช่ JWT → return `""`
- **จุดเด่น:** ได้ email ทันทีจาก request เดียว ไม่ต้องรออะไรเพิ่ม
- หมายเหตุสำคัญ: **Claude Code CLI/VSCode รุ่นที่ใช้ subscription JWT จริงๆ มักไม่มี email claim** ในนั้น (ยืนยันจาก debug log) จึงต้องพึ่งช่องทางที่ 2 แทน

### 3.2 ช่องทางที่ 2 — Claude Code + Metrics (กลไกหลักของระบบ)

ปัญหา: Claude Code (CLI/VSCode) จำนวนมาก authenticate ด้วย **raw API key (`sk-ant-...`)** ซึ่ง JWT ไม่มี email และ raw key ก็ไม่มี email เช่นกัน

ทางแก้แบบ 2 จังหวะ ที่ผูกด้วย `account_uuid` (id ประจำตัวที่เสถียร ไม่ผูก IP):

1. **ทุก `/v1/messages` request body พก `metadata.user_id`** ซึ่งเป็น JSON string ที่มี `account_uuid`, `device_id`, `session_id` — ดึงด้วยฟังก์ชัน `_meta_account_uuid()`
2. **Endpoint `POST /api/claude_code/metrics`** (จับโดย `ClaudeCodeMetricsMonitor` บน `.request()`) body มี `user.email` + `user.account_uuid` + `user.account_id` + `organization.id` + ข้อมูล OS/arch/version/terminal

เมื่อ metrics วิ่งมา addon จะ:
- สร้าง map `_EMAIL_BY_UUID[account_uuid] = email`
- สร้าง map `_EMAIL_BY_TOKEN[sha256(OAuth token)] = email` (เพราะ token เดียวกันถูกส่งทั้งบน metrics และ `/v1/messages`)
- เก็บ device info (OS, version, arch, terminal) keyed ด้วย email
- ตั้ง `device_id = account_uuid` ถ้ายังว่าง

ผลคือเมื่อ prompt ตัวถัดไป (`/v1/messages`) วิ่งมาพร้อม `account_uuid` ใน metadata ระบบจับ uuid ไปเทียบ `_EMAIL_BY_UUID` ก็รู้ทันทีว่าเป็นใคร — **VPN-safe** เพราะ account_uuid ไม่เปลี่ยนตาม IP

> เหตุที่ใช้ token เป็นตัวเชื่อม metrics กับ /v1/messages แทน IP: token เดียวกันวิ่งทั้งสอง endpoint ในเซสชันที่ login แล้ว ทำให้ link ได้แม้ผ่าน VPN (รีเฟรชอัตโนมัติเมื่อ token หมุน)

### 3.3 ช่องทางที่ 3 — claude.ai Chat (Session Cookie)

- **ใช้กับ:** Claude Desktop app และ claude.ai บนเว็บ ในโหมด chat (endpoint `.../completion`)
- **กลไก:** `ClaudeAccountSniffer` เฝ้าดู response JSON ของ endpoint ที่เชื่อถือได้ (whitelist) ที่คืน "ข้อมูลผู้ใช้ปัจจุบัน" เท่านั้น:
  - `/api/auth/current_account`
  - `/api/account`
  - `/api/bootstrap`, `/api/bootstrap/{org}`, `/edge-api/bootstrap/{org}/app_start`
- ดึง `email_address` + `full_name` + `uuid` ของผู้ใช้ปัจจุบัน (ฟังก์ชัน `_extract_current_user` — อ่านเฉพาะ shape ที่รู้จัก ไม่ recursive เพื่อเลี่ยงการหยิบ email ฝ่าย support/marketing ในก้อน config)
- ผูก email กับ `sha256(sessionKey cookie)` ผ่าน `_set_session_email()` → เก็บใน `_EMAIL_BY_SESSION`
- เมื่อ prompt ส่งมาทาง `.../completion` ใช้ cookie เดียวกัน → map กลับเป็น email
- **ความปลอดภัย:** เก็บเฉพาะค่า hash ของ cookie ไม่เก็บ session token ดิบในหน่วยความจำ
- endpoint นอก whitelist ที่บังเอิญมี email จะถูก print เป็น candidate เพื่อ review แต่**ไม่ cache** (กัน member list / support address ปนเข้ามา)

### 3.4 ช่องทางที่ 4 — Bridge WebSocket (Claude Code OAuth)

- **ใช้กับ:** Claude Code (CLI/VSCode) ที่ login แบบ account ซึ่งใช้ WebSocket ต่อไป `bridge.claudeusercontent.com` แทน REST API ทำให้ HTTP-based sniffer มองไม่เห็น email
- **กลไก:** `ClaudeBridgeMonitor` ดู WS message ตอน handshake `type=connect` ซึ่งพก account blob เช่น `{"account":{"email_address":"x@y.com","uuid":"..."}}` — ลองหลาย shape (`account`/`user`/`auth`, `email_address`/`email`)
- เก็บ email ผูกกับ session ของ WS นั้น แล้ว flush เป็น log ทุกครั้งที่ stream ตอบจบ
- ดึง `device_id` จาก handshake หรือจาก `target_device_id` ในข้อความถัดๆ มา
- map bridge `client_type` → ชื่อ client ของเรา (`claude-code` → `claude-code-cli`, `vscode` → `claude-code-vscode`)

### 3.5 ช่องทางเสริม — JWT บน `/v1/messages` ฝั่ง request

`ClaudeAPIMonitor.request()` ยังถอด JWT ของ `/v1/messages` (ถ้าเป็น JWT จริง ไม่ใช่ sk-) เพื่อเก็บ email + name + `sub` (เป็น uuid) เข้า `_set_account_email()` ครอบคลุมกรณีที่ผู้ใช้ไม่เคยเปิด claude.ai/Desktop และ traffic วิ่งตรงไป api.anthropic.com

### 3.6 Persistent Identity (จำข้ามการ restart)

- map `account_uuid→email`, account attributes, device attributes ถูก persist ลงไฟล์ `proxy/identity_cache.json` (ฟังก์ชัน `_persist_identity()`)
- ตอน addon start จะ `_load_identity_seed()` โหลด cache กลับ → prompt resolve ได้ทันทีไม่ต้องรอ metrics ยิงใหม่ (ลบช่วง cold-start ที่ email resolve ได้แต่ account_id/os ยังว่าง)
- รองรับการเพิ่ม `"account_uuid": "email"` เองในไฟล์ สำหรับ account ที่ไม่เคยยิง metrics
- เหตุผลด้านความปลอดภัย: identity (email/uuid/account_id) ไม่ใช่ความลับเหมือน session token จึง persist ลงดิสก์ได้ (ต่างจาก cookie hash ที่อยู่ใน memory เท่านั้น)
- รองรับไฟล์ legacy `uuid_email_map.json` แบบ load-only เพื่อ backward-compat

### 3.7 สรุปตารางเงื่อนไขการได้ email

| Platform / Client | Auth ที่ใช้ | ที่มาของ email | ฟังก์ชัน/Addon |
|---|---|---|---|
| api.anthropic.com `/v1/messages` (subscription JWT) | Bearer JWT | `email` claim ใน JWT โดยตรง | `_jwt_email()` |
| Claude Code CLI/VSCode (raw sk-key) | raw `sk-ant-…` | `account_uuid` → email map (เติมจาก metrics) | `_meta_account_uuid()` + `ClaudeCodeMetricsMonitor` |
| claude.ai chat (Desktop / web) | session cookie | sniff `current_account` → `sessionKey` cookie → email | `ClaudeAccountSniffer` + `_session_key()` |
| Claude Code OAuth (bridge) | WebSocket | `account.email_address` ใน `connect` handshake | `ClaudeBridgeMonitor` |

> ถ้าทุกช่องทาง resolve ไม่ได้ → email ว่าง → ถูก email filter drop (ระบบ **ไม่เดา email จาก IP** เด็ดขาด)

---

## 4. การเก็บข้อมูลในหน้า New Identity

### 4.1 ตาราง `email_identity` — ทะเบียนตัวตน canonical

หน้า **New Identity** (`/new-identity`) แสดงข้อมูลจากตาราง `email_identity` ซึ่งเป็น **"ทะเบียนตัวตน canonical: 1 คน 1 แถว" keyed ด้วย email** (VPN-safe) รวมทุก IP / device / client ของคนคนเดียวให้เหลือแถวเดียว — ต่างจากหน้า Identity เดิมที่ผูกกับ IP (1 IP 1 แถว ทำให้คนเดียวกระจายหลายแถวเมื่อใช้ VPN)

โครงสร้างตาราง (`0010_email_identity.sql`):

| คอลัมน์ | ชนิด | ความหมาย |
|---|---|---|
| `email` | TEXT PRIMARY KEY | email = แกนระบุตัวตน |
| `name` | TEXT | ชื่อผู้ใช้ |
| `account_id` | TEXT | account id ของ Anthropic |
| `uuid` | TEXT | account uuid / device id |
| `org_id` | TEXT | organization id |
| `anon_id` | TEXT | Segment anonymousId (vestigial — เลิกใช้แล้ว) |
| `os_type`, `os_version` | TEXT | ระบบปฏิบัติการ |
| `host_arch` | TEXT | สถาปัตยกรรม CPU เช่น amd64 |
| `app_version` | TEXT | เวอร์ชัน Claude Code |
| `terminal` | TEXT | ชนิด terminal |
| `ips` | TEXT | รายการ IP (comma-separated) ที่คนนี้เคยใช้ |
| `client_types` | TEXT | รายการชนิด client (comma-separated) ที่เคยใช้ |
| `first_seen` | INTEGER | เวลาที่เห็นครั้งแรก (epoch ms) |
| `updated_ms` | INTEGER | เวลาที่อัปเดตล่าสุด |

มี index บน `account_id` และ `anon_id` (เฉพาะแถวที่ค่าไม่ว่าง) และตอนสร้างตารางมีการ **seed ข้อมูลเริ่มต้นจากตาราง `ip_identity` เดิม** (group by email) เพื่อให้หน้าไม่ว่างก่อน traffic จริงจะเข้ามาเติม

### 4.2 หน้าจอ New Identity แสดงอะไร

**การ์ดสถิติด้านบน 4 ใบ:**
- จำนวนผู้ใช้ (นับ email)
- Calls รวม (ผลรวมจำนวน call ของทุกคน)
- จำนวนที่มี Device Info (มี os_type)
- จำนวนที่มี Anon ID

**คอลัมน์ในตาราง:** Email, Name, Account ID, UUID, Anon ID, OS, Arch, App Version, Terminal, Clients (แสดงเป็น badge สีตามชนิด client), First Seen, Last Seen (มีจุดสีบอกสถานะ live/idle/cold), จำนวน Calls

แต่ละ client มีสีประจำตัว เช่น `claude-code-cli` = น้ำเงิน, `claude-code-vscode` = ม่วง, `claude-desktop` = ส้ม, `claude-desktop-cowork` = เขียว, `api` = เทา คลิกที่ email จะลิงก์ไปหน้า `/account?identity=<email>`

### 4.3 กลไก Merge ข้อมูล (Upsert) — `upsertEmailIdentity()`

ทุกครั้งที่ log เข้ามาพร้อม `account_email` (ใน `handleLog`) จะ upsert ลง `email_identity` ด้วยกฎ:

- **ฟิลด์ attribute (name, account_id, uuid, org_id, anon_id, os, arch, app_version, terminal):** เติมแบบ **non-destructive** — ถ้าค่าใหม่ไม่ว่างจึงทับ ถ้าค่าใหม่ว่างให้คงค่าเดิมไว้ (กันข้อมูลดีถูกทับด้วยค่าว่าง)
- **`client_types`:** ต่อท้ายแบบ **ไม่ซ้ำ (dedupe)** — ถ้า client ชนิดนั้นมีอยู่แล้วในรายการก็ไม่เพิ่ม ถ้ายังไม่มีก็ append คั่นด้วย comma → เก็บครบทุกชนิด client ที่คนนั้นเคยใช้
- **`first_seen`:** เก็บค่าแรกสุดเสมอ (ถ้าเดิมเป็น 0 จึงใส่ค่าใหม่)
- **`updated_ms`:** อัปเดตเป็นเวลาปัจจุบันทุกครั้ง

> หมายเหตุ: ใน `handleLog` ค่า `uuid` ที่ upsert มาจากฟิลด์ `device_id` ของ log

**ผลลัพธ์:** 1 email จะค่อยๆ สะสมข้อมูลครบจากทุก device / network / client ที่คนนั้นใช้ โดยไม่สับสนแม้เปลี่ยน IP ผ่าน VPN

### 4.4 หน้าอื่นที่เกี่ยวข้อง

| หน้า | Route | บทบาท |
|---|---|---|
| **New Identity** ⭐ | `/new-identity` | ทะเบียน canonical ต่อคน (keyed ด้วย email) — live |
| **Logs** ⭐ | `/logs` | ตาราง log แบบ full-field + filter (period/date/model/account/client) + pagination |
| Identity (เดิม) | `/identity` | snapshot ประวัติ IP↔email แบบ **frozen** (ไม่อัปเดตแล้ว) จาก `ip_identity_backup` |

---

## 5. สรุป Before → After

| ประเด็น | เดิม (IP-based) | ใหม่ (Email-based) |
|---|---|---|
| แกนระบุตัวตน | IP (ระบบ 4 ชั้น L1–L4) | **Email จาก token ของ request** |
| ที่มา email | sniff + ยืมตาม IP | JWT / account_uuid / session cookie / bridge ของ request เอง |
| VPN เปลี่ยน IP | ❌ attribute ผิดคน | ✅ ไม่กระทบ (VPN-safe) |
| email ว่าง | เดาจาก IP (`ip:10.x.x.x`) | drop ด้วย email filter |
| ตาราง identity | `ip_identity` (live) | `email_identity` (live) + `ip_identity_backup` (frozen) |
| `client_ip` | ใช้ระบุตัวตน | audit เท่านั้น |

**One-liner:** เปลี่ยนจาก *"เดาตัวตนจาก IP"* → *"อ่านตัวตนจาก token ที่ request พกมาเอง"* — ระบุตัวตนด้วย email (VPN-safe) ดึงจาก JWT / account_uuid / session cookie / bridge โดยตรง ไม่สับสนแม้ผู้ใช้เปลี่ยน IP ผ่าน VPN

---

## 6. คำศัพท์สำคัญ (Glossary)

- **VPN-safe** = ระบุตัวตนถูกต้องแม้ผู้ใช้เปลี่ยน IP ผ่าน VPN (เพราะไม่ผูกตัวตนกับ IP)
- **account_uuid** = id ประจำบัญชี Anthropic ที่เสถียร ไม่เปลี่ยนตาม IP — ลิงก์หลักของ Claude Code
- **session cookie (sessionKey)** = cookie ของ claude.ai ที่ระบุเซสชัน login — เก็บเป็น sha256 hash เท่านั้น
- **metrics endpoint** = `/api/claude_code/metrics` แหล่งเดียวที่ Claude Code เปิดเผยทั้ง email + account_uuid พร้อมกัน
- **canonical identity** = ทะเบียนตัวตนหลัก 1 คน 1 แถว (ตาราง `email_identity`)
- **fire-and-forget** = ส่ง log ผ่าน thread แยกโดยไม่รอผล ไม่หน่วงผู้ใช้
- **non-destructive merge** = อัปเดตข้อมูลโดยไม่ทับค่าดีเดิมด้วยค่าว่าง
