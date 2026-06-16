# สรุปการเปลี่ยนแปลง: ระบบ Identity จาก IP → Email (VPN-safe)

> เอกสารสรุปการแก้ไขรอบล่าสุด (2026-06) สำหรับทำ presentation
> ขอบเขต: เปลี่ยนแกนระบุตัวตนของ SDB AI Insight จาก **IP-based** เป็น **Email-based**

---

## 1. ปัญหา & เหตุผล (The Why)

| หัวข้อ | รายละเอียด |
|---|---|
| **ปัญหาเดิม** | ใช้ **IP เป็นแกน identity** (ระบบ 4 ชั้น L1–L4 + ตาราง `ip_identity` + "ยืม email ตาม IP") |
| **อาการ** | VPN เปลี่ยน IP ตลอดเวลา → **attribute ผิดคน** |
| **ตัวอย่าง** | User A เคยใช้ IP X วันนี้ User B ได้ IP X ผ่าน VPN → log ของ B ถูกยืม email ของ A อัตโนมัติ |
| **แนวคิดใหม่** | ทุก prompt **พก token ระบุตัวตนของตัวเองมากับ request อยู่แล้ว** → ใช้ token นั้นแทน IP |

---

## 2. โมเดลใหม่ — Identity = Email (ไม่ใช้ IP)

ดึง email จาก **token ที่ติดมากับ request เอง** แยกตาม endpoint:

| Endpoint | Clients | ที่มาของ email | ฟังก์ชัน |
|---|---|---|---|
| `api.anthropic.com/v1/messages` | CLI / VSCode / Desktop-Code / **Cowork** | **Bearer JWT** ของ request เอง | `_jwt_email()` |
| `claude.ai/.../completion` | Desktop / web **chat** | **session cookie → email** map | `_session_key()` + `ClaudeAccountSniffer` |

**หลักการสำคัญ:**
- `client_ip` ยังเก็บใน `api_logs` แต่ **เป็น audit เท่านั้น — ไม่ใช้ระบุตัวตน**
- จับ email ไม่ได้ → log โดน email filter drop (**ไม่เดาจาก IP อีกต่อไป**)
- device/account info (OS / arch / `account_id` / `org_id`) cache **keyed ด้วย email** → VPN-safe

---

## 3. การเปลี่ยนแปลงฝั่ง Proxy (`proxy/addon.py`)

### Caches ใหม่ — keyed ด้วย EMAIL (เลิก keyed ด้วย IP)
```
_ACCOUNT_BY_EMAIL   email → {name, uuid, account_id, org_id}
_DEVICE_BY_EMAIL    email → {app_version, os_type, os_version, host_arch, terminal, device_id, mac_address}
_EMAIL_BY_SESSION   sha256(sessionKey cookie) → email   (claude.ai chat)
```
> เดิม: `_ACCOUNT_BY_IP` ตัวเดียว — bug บน shared proxy เพราะ auth response ของใครก็ได้ทับ email ของทุกคน

### ฟังก์ชันใหม่
- **`_jwt_email(flow)`** — ถอด email จาก Bearer JWT (ข้าม raw API key `sk-...`)
- **`_session_key(flow)`** — sha256 ของ sessionKey cookie (ไม่เก็บ token ดิบในหน่วยความจำ)
- **`current_email(flow)`** — resolve email: ① JWT บน request → ② session cookie map (ไม่มี IP)
- **`_set_account_email()` / `_set_session_email()`** — merge attribute แบบ non-destructive

### Monitor ใหม่: `ClaudeCodeMetricsMonitor`
ดัก `POST api.anthropic.com/api/claude_code/metrics` → เก็บ OS / arch / app-version / terminal + `account_id` / `org_id` **keyed ด้วย user.email** (ทำงานบน `.request()` ให้ cache พร้อมก่อน `/v1/messages` ตัวถัดไป)

### ที่ถูกถอดออก
- **`ClaudeSegmentMonitor` (anonymousId ตาม IP)** → ลบออกจาก addons (host ไม่มี session cookie → correlate ไม่ได้ → `anon_id` หมดความจำเป็น)
- ทุก log เพิ่ม `**_device_info(email)` (เติม device/account field ตอนเขียน log)

---

## 4. การเปลี่ยนแปลงฝั่ง Worker / Database

### Migrations ใหม่ (0006 → 0011)
| Migration | ทำอะไร |
|---|---|
| `0006_device_info.sql` | เพิ่ม device/env fields ใน `api_logs` (app_version, os_type, os_version, host_arch, terminal, device_id, mac_address) |
| `0007_identity_account_id.sql` | เพิ่ม `account_id` + `org_id` ใน `ip_identity` |
| `0008_anon_id.sql` | เพิ่ม `anon_id` (Segment anonymousId) — ภายหลังเลิกใช้ |
| `0009_identity_device_fields.sql` | snapshot `ip_identity` → `ip_identity_backup` + เพิ่ม device/timeline fields |
| `0010_email_identity.sql` | **สร้างตาราง `email_identity`** (canonical record keyed ด้วย email) + seed จาก `ip_identity` |
| `0011_drop_ip_identity.sql` | **DROP `ip_identity`** — เลิกใช้ IP เป็น identity |

### ตารางหลังเปลี่ยน
| Table | บทบาท |
|---|---|
| `api_logs` | log ทุก call + device fields (`client_ip` = audit เท่านั้น) |
| **`email_identity`** ⭐ | **canonical identity ต่อคน** (keyed ด้วย email) — name, account_id, org_id, anon_id, device info, ips, client_types, first_seen |
| `ip_identity_backup` | snapshot **แช่แข็ง** ของ IP↔email เดิม (powers หน้า `/identity`) — ไม่อัปเดตแล้ว |
| ~~`ip_identity`~~ | **ลบทิ้งแล้ว** |

### โค้ดที่แก้ (TypeScript)
- **`db/queries.ts`** — เพิ่ม `upsertEmailIdentity()`, `fetchEmailIdentityList()`, `fetchIdentityBackup()`, `fetchLogsData()`; ลบ `lookupIdentityByIp()` / `upsertIdentity()`; query ทุกตัวเลิกใช้ `IDENTITY_EXPR` → ใช้ `account_email` ตรงๆ
- **`routes/log.ts`** — ลบ "L3 fill-in ยืม email ตาม IP"; เปลี่ยนเป็น `upsertEmailIdentity()`
- **`db/filters.ts`** — ลบ `IDENTITY_EXPR` (`CASE ... ip:<client_ip>`) ออกทั้งหมด
- **`lib/account.ts`** — ลบ `IP_PREFIX` / `isIpIdentity()` / `stripIpPrefix()`; `displayAccount()` รับแค่ email
- **`lib/badge.ts`** — `accountBadge()` ตัด `ip-fallback` chip ออก
- **`db/queries-extra.ts`** / **`routes/clear-data.ts`** — เลิกรองรับ `ip:...` identity, group by `account_email` ตรงๆ
- **`types.ts`** — ลบ interface `IpIdentity`; `ApiLog` เพิ่ม device fields

---

## 5. หน้าใหม่ใน Dashboard (Sidebar)

| หน้า | Route | แสดงอะไร |
|---|---|---|
| **New Identity** ⭐ | `/new-identity` | canonical identity ต่อคน (keyed ด้วย email) — name, account_id, org_id, device info, client types, ips |
| **Logs** ⭐ | `/logs` | ตาราง log แบบ full-field พร้อม filter (period / date / model / account / client) + pagination |
| Identity (เดิม) | `/identity` | เปลี่ยนเป็น **snapshot ประวัติ** IP↔email (frozen, ไม่อัปเดต) จาก `ip_identity_backup` |

ไฟล์ใหม่: `routes/logs.ts`, `views/logs.ts`, `views/new-identity.ts`

---

## 6. สรุปก่อน / หลัง

| ประเด็น | เดิม (IP-based) | ใหม่ (Email-based) |
|---|---|---|
| แกน identity | IP (4 ชั้น L1–L4) | **Email จาก token ของ request** |
| ที่มา email | sniff + ยืมตาม IP | JWT / session cookie ของ request เอง |
| VPN เปลี่ยน IP | ❌ attribute ผิดคน | ✅ ไม่กระทบ |
| email ว่าง | เดาจาก IP (`ip:10.x.x.x`) | drop ด้วย email filter |
| ตาราง identity | `ip_identity` (live) | `email_identity` (live) + `ip_identity_backup` (frozen) |
| `client_ip` | ใช้ระบุตัวตน | audit เท่านั้น |

---

## 7. ไฟล์ที่แก้ทั้งหมด (22 modified + ไฟล์ใหม่)

**Proxy:** `proxy/addon.py` (+289 บรรทัด), `proxy/PROXY-GUIDE.md`
**Worker — core:** `index.ts`, `types.ts`, `schema.sql`, `routes/log.ts`, `routes/identity.ts`, `routes/clear-data.ts`, `db/queries.ts`, `db/queries-extra.ts`, `db/filters.ts`, `lib/account.ts`, `lib/badge.ts`
**Worker — views:** `views/dashboard.ts`, `views/identity.ts`, `views/layout.ts`, `views/shared.css`, `views/sidebar.html`
**ไฟล์ใหม่:** `migrations/0006`–`0011`, `routes/logs.ts`, `views/logs.ts`, `views/new-identity.ts`, `diagrams/06-er-schema.mmd|png`
**เอกสาร:** `IDENTITY-LAYERS-PLAN.md` (mark SUPERSEDED), `PRESENTATION-FLOW.md` (Slide 6 ใหม่), `GUIDE-FLOW.md`, `SDB-AI-INSIGHT-NOTEBOOKLM.md`

---

## 8. One-liner สำหรับสไลด์ปิด

> **เปลี่ยนจาก "เดาตัวตนจาก IP" → "อ่านตัวตนจาก token ที่ request พกมาเอง"**
> ระบุตัวตนด้วย email (VPN-safe) ดึงจาก JWT / session cookie โดยตรง — ไม่สับสนแม้ผู้ใช้เปลี่ยน IP ผ่าน VPN
