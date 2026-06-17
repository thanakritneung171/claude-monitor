# Worker Guide — คู่มือฉบับละเอียดของฝั่ง Worker

คู่มือนี้อธิบาย **เฉพาะ** ส่วน `worker/` ของ claude-monitor — ตั้งแต่ว่าระบบนี้คืออะไร ไปจนถึง flow การทำงานของ endpoint

> proxy: [../proxy/PROXY-GUIDE.md](../proxy/PROXY-GUIDE.md) · ภาพรวมทั้ง stack: [../README.md](../README.md) · โครงสร้างไฟล์: [STRUCTURE.md](STRUCTURE.md)

---

## สารบัญ

1. [ระบบนี้คืออะไร](#1-ระบบนี้คืออะไร)
2. [Flow การทำงาน](#2-flow-การทำงาน)
3. [Auth — Logto OIDC](#3-auth--logto-oidc)

---

## 1. ระบบนี้คืออะไร

**Claude Monitor Worker** (ชื่อ deploy: `claude-monitor-hooks`) คือ **Cloudflare Worker** ที่ทำหน้าที่เป็น backend ของ claude-monitor มีงานหลัก:

1. **รับ log** จาก mitmproxy addon ผ่าน `POST /log` → เขียนลง **Cloudflare D1** (ชื่อ DB `prompt-logger`) พร้อม upsert ทะเบียนตัวตนต่อ email
2. **เสิร์ฟ Dashboard หลายหน้า** (Dashboard, Logs, Analytics, Accounts, Identity, Insights, Reports, Monitoring ฯลฯ) — ป้องกันด้วย Logto login
3. **Health check** + **export** (CSV/XLSX) + **settings**

### 1.1 ตำแหน่งใน stack

```
┌──────────────┐    POST /log    ┌────────────────┐         ┌──────────────┐
│ mitm proxy   │ ──────────────► │  Cloudflare    │ ──SQL──►│ Cloudflare   │
│ (addon.py)   │  X-Api-Key auth │  Worker        │         │ D1 database  │
└──────────────┘                 │  claude-       │ ◄──SQL──│ "prompt-     │
                                 │  monitor-hooks │         │  logger"     │
┌──────────────┐  GET (Logto)    │                │         └──────────────┘
│ Browser      │ ──────────────► │                │
│ (Dashboard)  │ ◄── HTML ────── │                │
└──────────────┘                 └────────────────┘
```

- **Stateless** — Worker ไม่เก็บ state ใดๆ ทุกอย่างอยู่ใน D1 (รวม session)
- **Edge-deployed** — รันบน Cloudflare edge network ทั่วโลก
- **Modular** — `index.ts` เป็น dispatcher แตก handler ไป `routes/` (ดู [STRUCTURE.md](STRUCTURE.md))

### 1.2 องค์ประกอบหลัก

| ไฟล์ / ทรัพยากร | บทบาท |
|---|---|
| [src/index.ts](src/index.ts) | route dispatcher |
| [src/routes/](src/routes/) | handler ของแต่ละ endpoint |
| [schema.sql](schema.sql) | init schema (`api_logs` + auth tables) |
| [migrations/](migrations/) | ALTER scripts `0001`–`0011` (ถึง `email_identity`) |
| [wrangler.jsonc](wrangler.jsonc) | deploy config — D1 binding + account_id + `LOGTO_*` vars |
| **D1 database `prompt-logger`** | storage จริง |
| **Secret `API_KEY`** | bearer token auth `POST /log` (`wrangler secret put`) |

### 1.3 Tools / Tech stack

| Tool | Version | บทบาท |
|---|---|---|
| Cloudflare Workers | `compatibility_date: 2025-04-01` | runtime — serverless V8 isolate |
| Cloudflare D1 | — | SQLite-compatible serverless database |
| TypeScript | ^5.5 | source language |
| Wrangler CLI | ^3.101 | deploy / migrate / secret |
| Vitest + @cloudflare/vitest-pool-workers | ~3.2 | unit test runner |
| **jose** | ^5.10 | ตรวจ/ถอด Logto OIDC token |
| **fflate** | ^0.8 | zip → XLSX export |

### 1.4 Endpoints

| Method | Path | Auth | หน้าที่ |
|---|---|---|---|
| POST | `/log` | `X-Api-Key` | รับ log → `INSERT OR IGNORE` + `upsertEmailIdentity()` |
| GET | `/health` | — | health check `{ok:true}` |
| GET | `/login` · `/logout` · `/api/me` · `/` (`?code=`) | Logto | auth flow |
| GET | `/` | login | Dashboard (KPI + recent calls) |
| GET | `/logs` | login | full-field table + filter + pagination |
| GET | `/analytics` | login | trend chart + Export PDF |
| GET | `/accounts` · `/account` | login | สรุป/รายละเอียดราย account |
| GET | `/new-identity` | login | ทะเบียน canonical ต่อคน (keyed email) |
| GET | `/identity` | login | snapshot IP↔email (frozen) |
| GET | `/insights` · `/reports` · `/monitoring` · `/data-sources` | login | วิเคราะห์/รายงาน/สถานะ |
| GET | `/export` | login | download CSV/XLSX |
| GET/POST | `/settings` · `/settings/key-rotate` · `/settings/notifications` | login (admin) | ตั้งค่า + rotate ingest key |
| GET/POST | `/clear-data` | login | ล้างข้อมูล |
| OPTIONS | `*` | — | CORS preflight |
| (ไม่ match) | * | — | 404 JSON |

### 1.5 Database

**`api_logs`** (23 คอลัมน์) — จาก [schema.sql](schema.sql):

```sql
CREATE TABLE api_logs (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL,
  client, account_email, machine_name, model, prompt,
  prompt_chars, response_chars,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
  total_tokens, cost_usd,
  client_ip,                                       -- audit เท่านั้น (ไม่ใช้ระบุตัวตน)
  app_version, os_type, os_version, host_arch,     -- device info (จาก metrics)
  terminal, device_id, mac_address
);
```

Indexes: `ts DESC`, `model`, `client`, `machine_name`, `account_email`

**ตารางอื่น:**

| ตาราง | บทบาท | migration |
|---|---|---|
| `email_identity` | ทะเบียนตัวตน canonical keyed ด้วย email (VPN-safe) | `0010` |
| `ip_identity_backup` | snapshot ประวัติ IP↔email แบบ frozen (powers `/identity`) | `0009` |
| `sessions` · `oauth_state` | Logto session + OAuth state/PKCE | `0003`/`0004` |
| `app_settings` | key/value ตั้งค่า (เช่น ingest key, notifications) | `0002` |

> ตาราง `ip_identity` (เดิม) ถูก **DROP** ใน `0011` — เลิกใช้ IP เป็นแกน identity (VPN เปลี่ยน IP → attribute ผิดคน)

**`id` เป็น Primary Key + `INSERT OR IGNORE`** → idempotent: proxy retry ได้ไม่ duplicate

### 1.6 Dashboard ที่ผลิต

ไม่ใช่หน้าเดียวอีกต่อไป — เป็น **multi-page** ที่ใช้ shell ร่วม (`layout.ts` + sidebar) แต่ละหน้า server-render HTML (inline CSS + client.js เท่าที่จำเป็น) ตัวอย่างหน้า:

- **Dashboard (`/`)** — KPI cards (calls/tokens/cache/cost) + breakdown (model/client/account) + recent calls + modal ดู prompt เต็ม
- **Logs (`/logs`)** — ทุกฟิลด์ + filter (period/date/model/account/client) + pagination
- **Analytics (`/analytics`)** — trend chart, filter 24h/period, ปุ่ม Export PDF (print CSS landscape A4)
- **New Identity (`/new-identity`)** — 1 คน 1 แถว keyed ด้วย email รวมทุก IP/device/client

---

## 2. Flow การทำงาน

### 2.1 Dispatch

```typescript
// public ก่อน
if (pathname === '/log'   && method === 'POST') return handleLog(request, env);
if (pathname === '/health')                      return handleHealth();
if (pathname === '/login' && method === 'GET')   return handleLoginGet(url, env, request);
if (pathname === '/' && method === 'GET' && url.searchParams.has('code'))
                                                 return handleCallback(url, env, request);
// gate ทุก dashboard route
const gate = await requireUser(request, env);
if (gate.response) return gate.response;
const user = gate.user!;
if (pathname === '/'     && method === 'GET') return handleDashboard(url, env, user);
if (pathname === '/logs' && method === 'GET') return handleLogs(url, env, user);
// ...
return json({ ok:false, error:'Not Found' }, 404);
```

### 2.2 `POST /log` (ingest จาก proxy) — `routes/log.ts`

```
1. ตรวจ X-Api-Key === env.API_KEY  → ไม่ตรง = 401
2. parse JSON body เป็น Partial<ApiLog> (parse fail = 400)
3. insertLog(): INSERT OR IGNORE INTO api_logs (...) — ทุก field มี default
4. ถ้า account_email ไม่ว่าง → upsertEmailIdentity():
     - attribute (name/account_id/uuid/org_id/os/arch/version/terminal): non-destructive
       (ค่าใหม่ว่างไม่ทับค่าเดิม)
     - client_types: ต่อท้ายแบบ dedupe
     - first_seen: เก็บค่าแรกสุด · updated_ms: ปัจจุบันเสมอ
5. ตอบ {ok:true}
```

**จุดสำคัญ:** idempotent (INSERT OR IGNORE), defensive defaults, `client_ip` เก็บเป็น audit เท่านั้น

### 2.3 `GET /` (Dashboard)

รัน SQL หลายตัวพร้อมกันด้วย `Promise.all` (recent rows + totals + group by model/client/account) → ส่งเข้า view render → ตอบ HTML — query อิสระจากกัน ส่งพร้อมกันลด wall-time

### 2.4 Health / CORS / 404

- `/health` → `{ok:true}` ไม่ query DB ไม่มี auth
- `OPTIONS *` → allow-all preflight
- ไม่ match path/method ใด → 404 JSON

### 2.5 Error handling

| สถานการณ์ | ผล |
|---|---|
| `X-Api-Key` ไม่ตรง | 401 |
| body parse fail / D1 error | 400 พร้อม error |
| field ขาด/type ผิด | INSERT ผ่านด้วย default |
| `id` ซ้ำ | IGNORE → 200 (idempotent) |
| ยังไม่ login (dashboard route) | redirect ไป `/login` |

---

## 3. Auth — Logto OIDC

ตั้งแต่เปลี่ยนมาใช้ **Logto** (migration `0003_logto.sql` drop ตาราง local `users`/password) ทุก dashboard route ต้อง login ผ่าน Logto ก่อน (ยกเว้น `/log`, `/health`, `/login`, OAuth callback)

### 3.1 Flow

```
GET /<page> → requireUser()
   ├─ มี session cookie ที่ valid → ผ่าน
   └─ ไม่มี → redirect /login → Logto authorize (PKCE, state เก็บใน oauth_state)
        → Logto redirect กลับมาที่ "/" พร้อม ?code
        → handleCallback() แลก code เป็น token (jose ตรวจ) → สร้าง session ใน D1 → set cookie
GET /logout → ลบ session + Logto end-session (id_token_hint)
GET /api/me → คืนข้อมูล user ของ session ปัจจุบัน
```

### 3.2 Config (`wrangler.jsonc` → `vars`)

| Var | ค่า |
|---|---|
| `LOGTO_ENDPOINT` | URL ของ Logto tenant |
| `LOGTO_APP_ID` | App ID ของ Traditional Web App ใน Logto |
| `LOGTO_REDIRECT_URI` | = URL ของ Worker (`https://claude-monitor-hooks.<name>.workers.dev`) |
| `LOGTO_POST_LOGOUT_REDIRECT_URI` | ปลายทางหลัง logout |

> redirect URI ใน Logto console ต้องตรงกับ `LOGTO_REDIRECT_URI` เป๊ะ ไม่งั้น login วน

### 3.3 Roles / ingest key

- หน้าที่เป็น admin-only (เช่น rotate ingest key) เช็คใน `routes/settings.ts`
- **Rotate ingest API key:** `/settings` → Rotate key → คัดลอกค่าใหม่ไปอัปเดต `proxy/config.py` แล้ว restart proxy

---

## ลิงก์ที่เกี่ยวข้อง

- [src/index.ts](src/index.ts) — route dispatcher · [STRUCTURE.md](STRUCTURE.md) — โครงสร้างไฟล์
- [schema.sql](schema.sql) · [migrations/](migrations/) — DB
- [wrangler.jsonc](wrangler.jsonc) — deployment config
- [../proxy/PROXY-GUIDE.md](../proxy/PROXY-GUIDE.md) — ฝั่งที่ส่ง log มา
- [../SETUP.md](../SETUP.md) — install ตั้งแต่ต้น
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/) · [D1 docs](https://developers.cloudflare.com/d1/) · [Logto docs](https://docs.logto.io/)
