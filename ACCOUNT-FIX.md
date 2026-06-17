# Account Fix — Per-IP Account Scoping

> ## ⚠️ SUPERSEDED (2026-06) — บันทึกประวัติ
> เอกสารนี้คือวิธีแก้รุ่นเดิมที่ผูก account **ตาม IP** (per-IP scoping) — **เลิกใช้แล้ว** เพราะ VPN เปลี่ยน IP ทำให้ attribute ผิดคน ปัจจุบันระบบ resolve email จาก **token ที่ request พกมาเอง** (JWT / account_uuid / session cookie) ไม่ใช้ IP ดูโมเดลปัจจุบันที่ [CHANGES-IDENTITY-EMAIL.md](CHANGES-IDENTITY-EMAIL.md) + [CONTEXT-PROMPT-LOG-SYSTEM.md](CONTEXT-PROMPT-LOG-SYSTEM.md)

สรุปปัญหา + วิธีแก้สำหรับเคส `account_email` ผิดเมื่อ proxy ถูก deploy บน server กลาง

---

## 1. ปัญหา

`account_email` ใน log ไม่ตรงกับคนที่ใช้จริง

**สังเกตจาก:** หลายคนยิงผ่าน proxy server เดียวกัน → log ของ user A อาจติด email ของ user B

---

## 2. สาเหตุ

`proxy/addon.py` ออกแบบมาสำหรับ **single-user บนเครื่องตัวเอง** แต่ถูกนำไป deploy บน **shared proxy server** ที่หลายคนยิงผ่าน

### Root cause

`_ACCOUNT` เป็น **global state ตัวเดียวที่ใช้ร่วมกันทั้ง process**

```python
_ACCOUNT = {"email": "", "name": "", "uuid": "", "org_uuid": ""}

def current_email() -> str:
    return _ACCOUNT["email"]
```

`ClaudeAccountSniffer` overwrite ตัวนี้ทุกครั้งที่เห็น auth response จาก claude.ai โดยไม่สนว่าใครเป็นเจ้าของ request → **last-writer-wins**

### ตัวอย่าง race

| เวลา | เหตุการณ์ | `_ACCOUNT["email"]` | ผล |
|---|---|---|---|
| 10:00 | Alice เปิด claude.ai | `alice@softdebut.com` | — |
| 10:01 | Bob ยิง Claude Code | `alice@softdebut.com` | ❌ log Bob ติด email Alice |
| 10:02 | Bob เปิด claude.ai | `bob@softdebut.com` | — |
| 10:03 | Alice ยิง Claude Code | `bob@softdebut.com` | ❌ log Alice ติด email Bob |

### ที่อ่าน email ผิดทั้งหมด 3 จุด

- `ClaudeAPIMonitor._log` — `api.anthropic.com/v1/messages`
- `ClaudeDesktopMonitor.response` — `claude.ai/.../completion`
- `ClaudeBridgeMonitor._flush` — `bridge.claudeusercontent.com` WS

ทั้ง 3 จุดเรียก `current_email()` เหมือนกัน — ไม่รู้ว่า request นี้มาจากใคร

---

## 3. แนวทางที่พิจารณา

| แนวทาง | Static / Dynamic | ต้องแก้ client? | รองรับ multi-account |
|---|---|---|---|
| A. Source-IP scoped sniffer | Dynamic | ❌ ไม่ต้อง | ✅ |
| B. `X-Monitor-Identity` header | Static per-machine | ✅ ต้อง | ❌ |
| C. Hybrid (A + B) | Dynamic + fallback | ✅ บางส่วน | ✅ |
| D. แยก proxy port ต่อคน | Static | ✅ ต้อง | ❌ |

### เลือกแนวทาง A — Source-IP scoped sniffer

**เหตุผล:**

- ไม่ต้องแก้ฝั่ง client (install script เดิมใช้ได้)
- รองรับ 1 คนหลาย account (sniffer อัพเดต slot เมื่อ user สลับ account)
- Dynamic — สะท้อน Claude account ที่ใช้ยิงจริง ไม่ใช่แค่ "เจ้าของเครื่อง"

---

## 4. วิธีแก้

### Concept

แทนที่ `_ACCOUNT` ตัวเดียว → dict ที่แบ่งตาม source IP ของ client

```python
_ACCOUNT_BY_IP = {
    "10.10.84.42": {"email": "alice@softdebut.com", "name": "Alice", ...},
    "10.10.84.43": {"email": "bob@softdebut.com",   "name": "Bob",   ...},
}

def current_email(flow) -> str:
    ip = flow.client_conn.peername[0]
    return _ACCOUNT_BY_IP.get(ip, {}).get("email", "")
```

`flow.client_conn.peername[0]` เป็น IP ของ client ที่ mitmproxy ให้มา — ไม่ต้องตั้งอะไรฝั่ง client

### จุดที่แก้ใน `proxy/addon.py`

1. แทนที่ `_ACCOUNT` global → `_ACCOUNT_BY_IP` dict
2. เพิ่มฟังก์ชัน `_client_ip(flow)` ดึง IP จาก `flow.client_conn.peername`
3. `current_email()` รับ `flow` มาเป็น argument
4. `ClaudeAccountSniffer.response` เขียน email เข้า slot ตาม IP
5. `ClaudeAPIMonitor._log` รับ `flow` แล้วเรียก `current_email(flow)`
6. `ClaudeDesktopMonitor.response` เรียก `current_email(flow)`
7. `ClaudeBridgeMonitor.websocket_start` เก็บ `src_ip` ใน session
8. `ClaudeBridgeMonitor._flush` อ่าน email จาก `_ACCOUNT_BY_IP[sess["src_ip"]]`

### ฝั่ง client

**ไม่ต้องแก้อะไร** — `install-claude-proxy.ps1` เดิมใช้ได้ปกติ

---

## 5. Flow การทำงานหลังแก้

### ตอน user เปิด claude.ai (sniffer cache email)

```
Alice (10.10.84.42) → เปิด claude.ai
    └─ claude.ai response: /api/auth/current_account
        body: {email_address: "alice@softdebut.com"}
            └─ ClaudeAccountSniffer
                ip = "10.10.84.42"
                _ACCOUNT_BY_IP["10.10.84.42"] = {email: "alice@softdebut.com", ...}
```

Bob (10.10.84.43) ทำพร้อมกัน → `_ACCOUNT_BY_IP["10.10.84.43"]` แยกต่างหาก ไม่เขียนทับ

### ตอน user ยิง Claude Code call

```
Alice's VSCode (10.10.84.42) → POST api.anthropic.com/v1/messages
    └─ ClaudeAPIMonitor.response(flow)
        flow.client_conn.peername = ("10.10.84.42", ...)
            └─ self._log(flow, ...)
                email = current_email(flow)
                     = _ACCOUNT_BY_IP["10.10.84.42"]["email"]
                     = "alice@softdebut.com" ✓
```

Bob ยิงพร้อมกัน → flow ของ Bob มี IP "10.10.84.43" → อ่าน slot Bob → ติด email Bob **ไม่ปนกัน**

### ตอน Alice สลับ account

```
Alice sign out → sign in ด้วย alice.personal@gmail.com
    └─ claude.ai โหลด /api/auth/current_account ใหม่
        └─ ClaudeAccountSniffer
            slot["email"] เดิม = "alice@softdebut.com"
            email ใหม่         = "alice.personal@gmail.com"
            ต่างกัน → overwrite slot
                _ACCOUNT_BY_IP["10.10.84.42"] = {email: "alice.personal@gmail.com", ...}
```

ทุก call หลังจากนี้ของ Alice → ติด `alice.personal@gmail.com` อัตโนมัติ

### ตอน Claude Code OAuth (bridge WebSocket)

```
Alice CLI (10.10.84.42) → WebSocket upgrade bridge.claudeusercontent.com
    └─ ClaudeBridgeMonitor.websocket_start(flow)
        _sessions[id(flow)] = {
            "client":  "claude-code-cli",
            "src_ip":  "10.10.84.42",  ← เก็บ IP ตอน open
            "pending": {},
        }

    └─ message_stop → _flush(sess, req_id)
        email = _ACCOUNT_BY_IP[sess["src_ip"]]["email"]
             = "alice.personal@gmail.com" ✓
```

---

## 6. Platform ที่ครอบคลุม

| Platform | ครอบคลุม | หมายเหตุ |
|---|---|---|
| claude.ai (web) | ✅ | sniff `/api/auth/current_account` ทุกครั้งที่ refresh/สลับ account |
| Claude Desktop (Chat / Cowork / Code) | ✅ | sniff endpoint เดียวกับ claude.ai web |
| Claude Code VSCode (OAuth) | ⚠️ | จับได้เฉพาะถ้าเปิด Desktop / claude.ai บนเครื่องเดียวกันด้วย |
| Claude Code CLI (OAuth) | ⚠️ | เหมือน VSCode |
| Claude Code (API key) | ❌ | ไม่มี email ใน traffic เลย — `account_email = ""` |
| API SDK ทั่วไป | ❌ | เหมือน API key |

---

## 7. ข้อจำกัด

| สถานการณ์ | ผล |
|---|---|
| 2 user คนละ IP ใช้พร้อมกัน | ✅ แยก slot ไม่ปนกัน |
| 1 user สลับหลาย Claude account | ✅ sniffer overwrite slot |
| User ไม่เคยเปิด claude.ai | `account_email = ""` (ดีกว่าเดาผิด) |
| Claude Desktop + VSCode บนเครื่องเดียวกัน | ✅ slot เดียวกัน (คนเดียวกัน) |
| 2 user หลัง NAT IP เดียวกัน | ❌ ปนกัน (limitation) |
| Alice ออก → Bob มาใช้เครื่องเดิม ก่อนเปิด claude.ai | ❌ Bob ติด email Alice จนกว่าจะเปิด claude.ai |

---

## 8. สิ่งที่ยังไม่ได้แก้

- **`machine_name`** — ยังเป็นชื่อ server (จาก `socket.gethostname()` ตอน module load) ไม่ใช่เครื่อง user — แก้ทีหลังได้ด้วย reverse DNS lookup จาก source IP
- **TTL slot cleanup** — slot ค้างไม่หมดอายุ → เพิ่มทีหลังถ้าจำเป็น (เช่น expire slot ที่ไม่มี auth response > 24 ชม)
