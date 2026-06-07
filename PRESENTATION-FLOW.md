# SDB AI Insight — สรุป Flow & การทำงานแต่ละหน้า
> เอกสารสำหรับทำ Slide Presentation · อัปเดต 2026-05-20
>
> **SDB AI Insight** = ชื่อผลิตภัณฑ์/dashboard ที่ผู้ใช้เห็น · (ชื่อระบบเบื้องหลังในโค้ดคือ *Claude Monitor*)

เนื้อหาแบ่งเป็น 2 ส่วน:
1. **Flow การทำงานของระบบ SDB AI Insight** (Slide 1–9)
2. **แต่ละหน้าใน SDB AI Insight คืออะไร ทำงานอย่างไร** (Slide 10–20)

---

# 🔷 ส่วนที่ 1 — Flow การทำงานของระบบ SDB AI Insight

---

## 📌 Slide 1 — SDB AI Insight คืออะไร

ระบบ **monitoring การใช้งาน Claude AI** ขององค์กร — ดักจับทุก prompt/response ที่พนักงานส่งหา Claude จากทุก client แล้วสรุปเป็น **ค่าใช้จ่าย (USD), token usage, และพฤติกรรมการใช้งาน** บน dashboard

**ปัญหาที่แก้:** องค์กรจ่ายค่า Claude แต่ไม่รู้ว่า
- ใครใช้บ้าง / ใช้ไปเท่าไหร่ / model ไหนแพง
- ใช้ผ่านช่องทางไหน (Desktop, CLI, VSCode, Cowork, API)
- ค่าใช้จ่ายพุ่งผิดปกติตอนไหน

**Stack:** `mitmproxy (Python)` + `Cloudflare Workers` + `Cloudflare D1 (SQLite)` + `Logto (OIDC auth)`

---

## 📌 Slide 2 — สถาปัตยกรรมภาพรวม (3 ชั้น)

```
┌─────────────────────────────────────────────────────────────┐
│  1) CLIENTS                                                   │
│  Claude Desktop · Claude.ai web · Cowork · Code tab          │
│  Claude Code CLI · VSCode extension · API SDK                │
└───────────────┬─────────────────────────────────────────────┘
                │  ตั้ง HTTPS_PROXY = 127.0.0.1:8080
                ▼
┌─────────────────────────────────────────────────────────────┐
│  2) PROXY  —  mitmproxy + addon.py                            │
│  • ดักจับ traffic (TLS MITM)                                  │
│  • ตรวจ client / ดึง prompt / นับ token / คำนวณราคา           │
│  • ตรวจ email เจ้าของ call                                    │
│  • กรอง email (optional)                                      │
│         │                          │                          │
│         ▼                          ▼                          │
│   JSONL ในเครื่อง           POST /log → Worker                │
│   (log/claude_*.jsonl)                                        │
└───────────────────────────────────┬─────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3) CLOUDFLARE WORKER + D1                                    │
│  • รับ log, เติม identity, เก็บลง D1                          │
│  • Logto OIDC login                                           │
│  • Render Dashboard (HTML) — 11 หน้า                          │
└─────────────────────────────────────────────────────────────┘
```

**หลักการ:** Proxy เก็บข้อมูล (capture) → Worker เก็บ + แสดงผล (store + visualize) แยกหน้าที่กันชัดเจน

---

## 📌 Slide 3 — Flow การเก็บ 1 call (End-to-End)

```
ผู้ใช้พิมพ์ prompt ใน Claude
        │
        ▼
[1] traffic วิ่งผ่าน mitmproxy (เพราะตั้ง system proxy ไว้)
        │
        ▼
[2] addon.py จับ request/response:
      • _detect_client()      → รู้ว่ามาจาก client ไหน
      • _extract_prompt_*()    → ดึงข้อความที่ user พิมพ์จริง
      • _parse_sse_*()         → อ่าน token (in/out/cache)
      • _calc_cost()           → คำนวณ USD
      • current_email()        → หา email เจ้าของ
        │
        ▼
[3] _should_log(email)  → ผ่าน email filter ไหม?
        │
        ├──► เขียนไฟล์ JSONL ในเครื่อง (backup เผื่อ Worker ล่ม)
        │
        └──► POST /log ไป Worker (fire-and-forget, ไม่ block ผู้ใช้)
                │
                ▼
[4] Worker /log:
      • ตรวจ X-Api-Key
      • ถ้า email ว่าง → lookup จาก ip_identity (เติมให้)
      • INSERT ลง api_logs
      • ถ้ามี email → upsert ip_identity (จำไว้ใช้ครั้งหน้า)
        │
        ▼
[5] ข้อมูลขึ้น Dashboard ทันที (query สดจาก D1)
```

---

## 📌 Slide 4 — ชั้น Proxy: addon.py ทำอะไรบ้าง

**Monitor classes (เก็บข้อมูลจริง):**

| Class | ดักอะไร | Client tag |
|---|---|---|
| `ClaudeAPIMonitor` | `api.anthropic.com/v1/messages` | API key / Code CLI / VSCode / Cowork / Code tab |
| `ClaudeDesktopMonitor` | `claude.ai/.../completion` | Claude Desktop & web chat |
| `ClaudeBridgeMonitor` | `bridge.claudeusercontent.com` (WebSocket) | Claude Code OAuth login |
| `ClaudeAccountSniffer` | อ่าน email จาก `claude.ai` (ทำงานก่อนเสมอ) | — |
| `ToolSchemaFixer` | แก้ tool schema ที่ Anthropic API reject (oneOf/allOf/anyOf) | — |

**Discovery classes (debug เท่านั้น):**
- `ClaudeConnectionLogger` — log SNI ทุก TLS connection
- `ClaudeDesktopDiscovery` / `ClaudeBridgeDiscovery` — log endpoint/frame ที่ยังไม่รู้จัก

---

## 📌 Slide 5 — วิธีตรวจจับ Client (Client Detection)

ตรวจ 2 ชั้น เรียงตามความน่าเชื่อถือ:

**ชั้น 1 — Headers** (`_detect_client`): อ่าน `User-Agent`, `anthropic-client-name`, `x-app`, `x-client-context`

| เงื่อนไข | ผลลัพธ์ |
|---|---|
| `claude-code` + `electron` | `claude-desktop-code` |
| `claude-code` + `vscode` | `claude-code-vscode` |
| `claude-code` เพียวๆ | `claude-code-cli` |
| `electron` / `anthropic` ใน UA | `claude-desktop` |
| อื่นๆ | `api` |

**ชั้น 2 — Body override** (เมื่อ header กำกวม):
- body มี `mcp__cowork__*` → `claude-desktop-cowork` (ชนะเสมอ)
- body มี Code tools (`Bash`/`Read`/`Write`/`Edit`...) แต่ header เป็น `api` → `claude-code-cli`

---

## 📌 Slide 6 — วิธีตรวจจับตัวตน: Identity 4 Layers

> ปัญหา: บน proxy กลาง บาง log มี `account_email` ว่าง (25–64%) เพราะ subscription user ไม่ส่ง email ใน traffic ตรงๆ

แก้ด้วยการเก็บ identity กระจาย 4 ชั้น — แต่ละชั้น **รอดแยกกันได้** (proxy/worker restart ก็ไม่หาย):

| Layer | เก็บที่ไหน | บทบาท |
|---|---|---|
| **L1** `_ACCOUNT_BY_IP` | Proxy (in-memory) | hot read path — map IP → email ตอน log |
| **L2** `account_slots.json` | Proxy (ไฟล์) | mirror ของ L1 — รอด proxy restart |
| **L3** `ip_identity` table | Worker D1 | source of truth ระยะยาว — รอดทุกอย่าง |
| **L4** `api_logs.client_ip` | Worker D1 | audit ทุก row — fallback แสดงผล |

**3 แหล่งที่ได้ email มา:** HTTP sniffer (claude.ai), JWT decode (Bearer token), Bridge connect handshake (WebSocket)

**ถ้าหา email ไม่ได้เลย** → แสดงเป็น `ip:10.10.84.42` แทน (ยัง audit ได้ว่ามาจากเครื่องไหน)

---

## 📌 Slide 7 — การคำนวณค่าใช้จ่าย (Pricing)

ราคา USD ต่อ 1M tokens — แยกตาม tier ของ model:

| Model tier | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| **Opus** | $15 | $75 | $1.50 | $18.75 |
| **Sonnet** | $3 | $15 | $0.30 | $3.75 |
| **Haiku** | $0.80 | $4 | $0.08 | $1.00 |

```
cost = (input×Pin + output×Pout + cacheRead×Pcr + cacheWrite×Pcw) / 1,000,000
```

> นับ cache read/write แยก เพราะราคาต่างกันมาก — cache read ถูกกว่า input ปกติ ~10 เท่า

---

## 📌 Slide 8 — ชั้น Worker: Endpoints & Auth

**Public endpoints (ไม่ต้อง login):**

| Path | Method | หน้าที่ |
|---|---|---|
| `/log` | POST | รับ log จาก proxy (ตรวจ `X-Api-Key`) |
| `/health` | GET | health check |
| `/login` | GET | redirect ไป Logto |
| `/` (มี `?code=`) | GET | OAuth callback |
| `/logout` | GET | จบ session |

**Authenticated routes (ผ่าน `requireUser` gate):** ทุกหน้า dashboard

**Auth = Logto OIDC + PKCE:**
```
/login → Logto authorize → callback (?code=)
       → แลก token → verify id_token (JWKS)
       → สร้าง session (cookie sid, อายุ 7 วัน) → เข้า dashboard
```

---

## 📌 Slide 9 — Database (Cloudflare D1)

| Table | เก็บอะไร |
|---|---|
| `api_logs` | log ทุก call — ts, client, account_email, client_ip, model, prompt, tokens, **cost_usd** |
| `ip_identity` | map IP → email (Layer 3) — เติม email ให้ log ที่ระบุตัวไม่ได้ |
| `sessions` | session ผู้ใช้ที่ login (sub, email, expires_at, id_token) |
| `oauth_state` | state + PKCE verifier ระหว่าง OAuth flow |
| `app_settings` | ค่า config (ingest_key, notify flags) — key/value |

> ทุกเวลาคำนวณเป็น **Asia/Bangkok (UTC+7)** · เวลาเก็บเป็น ms epoch

---

# 🖥️ ส่วนที่ 2 — แต่ละหน้าใน SDB AI Insight คืออะไร ทำงานอย่างไร

> Sidebar แสดงหลัก 3 เมนู: **Dashboard · Analytics · Accounts**
> ส่วน Settings/Monitoring/Data Sources/Reports/Insights/Identity ซ่อนใน nav แต่เข้าผ่าน URL ได้

---

## 📌 Slide 10 — หน้า Dashboard (`/`)

หน้าหลัก — สรุปการใช้งานพร้อม filter ครบ

**ส่วนประกอบ:**
1. **Filter bar** — Period (Daily/Monthly/Yearly), Date from–to, Model, Account, Client + ปุ่ม **Export CSV** / **Apply**
2. **Stat cards (6 ใบ)** — จำนวน calls, token in/out, cache read/write, **cost รวม**
3. **Breakdown 3 การ์ด** — By Model · By Account · By Client (เรียงตาม cost)
4. **Recent API Calls** — ตารางทุก call: เวลา, client, account, model, prompt preview, token, cost
   - เลือก rows per page (10/20/50/100/All) + pagination
   - คลิก prompt → เปิด modal ดูข้อความเต็ม

---

## 📌 Slide 11 — หน้า Accounts (`/accounts`)

รายชื่อ account ทั้งหมดที่เชื่อมต่อ Claude พร้อมสรุปการใช้งานต่อคน

**ส่วนประกอบ:**
- **Period filter** — 7 วัน / 30 วัน / 90 วัน / ทั้งหมด
- **KPI สรุป** — total accounts, active accounts, total spend, total calls, ค่าเฉลี่ยต่อ account
- **ตาราง/การ์ด account** แต่ละแถวแสดง: avatar (สีจาก hash email), email, จำนวน calls, tokens, model ที่ใช้บ่อย, **cost**, และ **สถานะ**:
  - 🟢 `live` (< 1 ชม.) · 🟡 `idle` (< 7 วัน) · ⚪ `cold` (> 7 วัน)
- คลิกแถว → ไปหน้า **Account Detail**

---

## 📌 Slide 12 — หน้า Account Detail (`/account?identity=`)

เจาะลึกการใช้งานของ account เดียว (รับทั้ง email และ `ip:...`)

**ส่วนประกอบ:**
- **Period filter** (24h/7d/30d/90d/all) + filter ตาม client/model
- **Stat cards** — calls, tokens (in/out/cache), cost รวม, first/last seen + สถานะ live/idle/cold
- **Cost over time** — กราฟ trend ค่าใช้จ่ายรายวัน (30 วัน)
- **By Model / By Client** — breakdown ของคนนี้
- **Prompts ที่ใช้บ่อย** — top 5 พร้อมจำนวนครั้ง + ค่าเฉลี่ย
- **Token Usage** — สัดส่วน token
- **Activity heatmap** — 7 วัน × 24 ชม. (ใช้ตอนไหนบ่อย, เวลา BKK)
- **Prompts ล่าสุด** — 50 รายการล่าสุด

---

## 📌 Slide 13 — หน้า Analytics (`/analytics`)

ดู trend ค่าใช้จ่ายและ token เชิงลึกตามช่วงเวลา (เลือกได้ 7d / 30d / 90d)

**Totals (แถบสรุปบนสุด):** cost รวม, จำนวน calls, avg cost/call, token in/out, cache read/write

**กราฟทั้ง 5 — อธิบายแบบเข้าใจง่าย:**

| กราฟ | คืออะไร |
|---|---|
| **Cost over time** | **ราคาที่จ่ายไปกับการใช้งาน แยกตามช่วงเวลา** — เช่นในตัวอย่างมี 2 วัน คือ 18/05 กับ 19/05 (1 แท่ง/จุด = 1 วัน) |
| **Cost by model** | เทียบ trend ค่าใช้จ่ายของแต่ละ model (top 7) ว่าตัวไหนกินเงินมากสุด |
| **Token mix over time** | **จำนวน Token ที่ใช้แบ่งตามเวลา** — คำว่า "mix" คือรวม 4 ตัวซ้อนกัน: **Cache read · Cache write · Input · Output** (stacked area) |
| **Calls timeline** | **จำนวนครั้งที่เรียกใช้ (requests) รวมกัน เรียงตามช่วงเวลา แยกตามวัน** — นับเป็น "จำนวน call" ต่อวัน (ไม่ใช่ยอดเงิน) |
| **Activity heatmap** | **ความถี่ของจำนวนครั้งการ prompt ในแต่ละช่วงเวลาของวันนั้นๆ** — ตาราง 7 วัน × 24 ชม. ยิ่งเข้มยิ่งใช้บ่อย (เวลา BKK) |

> ⚠️ หมายเหตุ: **Calls timeline** ในโค้ดจริง plot *จำนวน requests ต่อวัน* (count) ไม่ใช่ยอดเงิน — ถ้าจะสื่อเรื่อง "ค่าใช้จ่ายรวมต่อวัน" ให้ดูที่กราฟ **Cost over time** แทน

---

## 📌 Slide 14 — หน้า Monitoring (`/monitoring`)

สถานะระบบแบบ real-time (ดูย้อนหลัง 24 ชม.)

**ส่วนประกอบ:**
- **KPI** — Calls (24h), **Error rate**, Active sessions (5 นาทีล่าสุด), Status
- **API Health** — error rate รายชั่วโมง
- **Active sessions** — session ที่กำลัง active (client + identity + model ล่าสุด)
- **Throughput** — calls/นาที ตลอด 24 ชม.
- **Top errors by group** — จัดกลุ่มตาม client/model
- **Alert rules** (read-only)

> นิยาม **error** = call ที่ `output_tokens = 0` และ `cost = 0` (ไม่มี response กลับมา)

---

## 📌 Slide 15 — หน้า Data Sources (`/data-sources`)

จัดการแหล่งข้อมูล/proxy ที่ป้อนข้อมูลเข้าระบบ

**ส่วนประกอบ:**
- **Claude API Proxy** — ข้อมูล proxy endpoint
- **Ingest endpoint** — URL `/log` + **ingest key** (แสดงแบบ mask `••••1234`)
- **Database (D1)** — สถิติ: จำนวน row รวม, row วันนี้, ช่วงเวลา oldest–newest, ขนาดข้อมูลโดยประมาณ
- **Setup instructions** — วิธีตั้งค่า proxy ให้ client

---

## 📌 Slide 16 — หน้า Identity (`/identity`)

ดูตาราง map **IP ↔ email** ปัจจุบัน (Layer 3) — ใช้เติม email ให้ log ที่ระบุตัวตนไม่ได้

**ส่วนประกอบ:**
- ตาราง: IP, email, name, uuid, อัปเดตล่าสุด, จำนวน calls ที่ผูกกับ IP นั้น
- เรียงตามเวลาอัปเดตล่าสุด

---

## 📌 Slide 17 — หน้า Reports (`/reports`)

สร้างรายงาน/export CSV

**ส่วนประกอบ:**
- **Quick export** — Today / This month / This year / All time (CSV)
- **Custom report** — เลือกช่วงวันที่ + filter model + เลือก columns
- **Recent exports** — (⏳ Incoming — ยังพัฒนา)

> Export จริงวิ่งผ่าน `/export?date_from=...&date_to=...` → คืนไฟล์ CSV

---

## 📌 Slide 18 — หน้า Settings (`/settings`)

จัดการ API key และการแจ้งเตือน

**ส่วนประกอบ:**
- **Profile** — email ผู้ใช้ปัจจุบัน
- **API key (ingest)** — แสดงแบบ mask + ปุ่ม **Rotate key** (proxy เก่าใช้ต่อไม่ได้จนกว่าจะอัปเดต config)
- **Notifications** (เก็บใน app_settings): Email digest · Cost anomaly alert · Budget threshold
- **About** — version, compatibility date, timezone (UTC+7), Identity provider (Logto), Runtime (Cloudflare)

---

## 📌 Slide 19 — หน้า Clear Data (`/clear-data`)

ลบข้อมูลในระบบ (⚠️ ใช้ระวัง)

**ลบได้ 4 แบบ:**
1. **All** — ลบ `api_logs` ทั้งหมด
2. **By range** — ลบตามช่วงวันที่
3. **By filter** — ลบตาม client / account / model
4. **Sessions** — ลบ session ทั้งหมด (logout ทุกคน)

> แสดง banner ยืนยันจำนวน row ที่ถูกลบทุกครั้ง

---

## 📌 Slide 20 — Insights (`/insights`)

⏳ **Incoming** — AI-driven findings จากการใช้งานจริง (ยังอยู่ระหว่างพัฒนา)

---

## 📌 Slide 21 — ผลิตภัณฑ์ Claude ที่ครอบคลุม

| Source | ช่องทาง | Client tag |
|---|---|---|
| Claude Code CLI (API key) | `api.anthropic.com/v1/messages` | `claude-code-cli` |
| Claude Code CLI (OAuth) | `bridge.claudeusercontent.com` WS | `claude-code-cli` |
| Claude Code VSCode | `api.anthropic.com/v1/messages` | `claude-code-vscode` |
| Claude Desktop chat | `claude.ai/.../completion` | `claude-desktop` |
| Claude.ai web chat | เหมือน Desktop | `claude-desktop` |
| **Cowork** (Desktop) | `/v1/messages?beta=true` | `claude-desktop-cowork` |
| **Code tab** (Desktop) | `/v1/messages?beta=true` | `claude-desktop-code` |
| Claude API SDK | `api.anthropic.com/v1/messages` | `api` |

---

## 📌 Slide 22 — ข้อจำกัดที่รู้

- **Mobile apps** — คนละเครื่อง ต้อง MITM ที่ network layer (router)
- **HTTP/3 (QUIC)** — mitmproxy ดักได้แค่ TCP (ปัจจุบันยังไม่กระทบ)
- **API key users** — ไม่มี email ใน traffic → ระบุได้แค่ IP (fundamental)
- **NAT/shared IP** — หลายคน IP เดียวกัน → แยกไม่ออก
- **First call ของ IP ใหม่** — ต้องรอ sniff/JWT ก่อน 1 call จึงจะได้ email

---

## 📌 Slide 23 — สรุป (Key Takeaways)

✅ **ดักทุกช่องทาง** — Desktop, web, Cowork, Code tab, CLI, VSCode, API ในที่เดียว
✅ **คิดเงินแม่นยำ** — แยก input/output/cache ตามราคาจริงของแต่ละ model
✅ **ระบุตัวตนทน fail** — 4-layer identity รอด proxy/worker restart
✅ **ไม่ block ผู้ใช้** — log แบบ fire-and-forget + backup JSONL ในเครื่อง
✅ **Dashboard ครบ** — ภาพรวม, รายคน, trend, real-time monitoring, export

**Stack:** mitmproxy → Cloudflare Workers + D1 → Logto auth → HTML dashboard
