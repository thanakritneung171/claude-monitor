# คู่มือ Proxy Scripts

Scripts ทั้งหมดอยู่ในโฟลเดอร์ `proxy/`

---

## ภาพรวม

| Script | วัตถุประสงค์ | รันบ่อยแค่ไหน |
|---|---|---|
| `install-cert.ps1` | ติดตั้ง CA cert ลง Windows Trust Store | **ครั้งเดียว** (ต้องเป็น Admin) |
| `install-claude-proxy.ps1` | ตั้ง proxy ให้ Claude Code + Claude Desktop (Cowork) | **ครั้งเดียว** |
| `install-proxy-env.ps1` | ตั้ง User-level env vars ครบชุด (มี `-Uninstall`) | **ครั้งเดียว** (ถ้าต้องการ env เพิ่มเติม) |
| `enable-proxy.ps1` | เปิด proxy สำหรับ session นี้ (dot-source) | ทุกครั้งที่เปิด terminal ใหม่ |
| `disable-proxy.ps1` | ปิด proxy สำหรับ session นี้ (dot-source) | เมื่อต้องการหยุดชั่วคราว |
| `uninstall-claude-proxy.ps1` | ถอด proxy config ออกทั้งหมด | เมื่อต้องการหยุดใช้งาน |

---

## รายละเอียดแต่ละไฟล์

### `install-cert.ps1`

**ต้องการ:** PowerShell ที่รันด้วยสิทธิ์ Administrator

ติดตั้ง CA certificate ของ mitmproxy ลงใน Windows Trusted Root Store เพื่อให้ทุก app บนเครื่องเชื่อถือ HTTPS ที่ผ่าน proxy ได้

```powershell
# เปิด PowerShell ด้วย Run as Administrator
.\install-cert.ps1
```

**ต้องทำก่อน:** รัน `start.ps1` หรือ `mitmdump` อย่างน้อยหนึ่งครั้งเพื่อให้ mitmproxy สร้าง cert ที่ `~/.mitmproxy/mitmproxy-ca-cert.pem` ก่อน

**หลังรัน:** restart Claude Desktop / VSCode / terminal

---

### `install-claude-proxy.ps1`

**วัตถุประสงค์:** ตั้งค่า proxy สำหรับ Claude tooling แบบ persistent ใน 2 ที่พร้อมกัน

| สิ่งที่ตั้ง | ผลลัพธ์ |
|---|---|
| `~/.claude/settings.json` → `env` block | Claude Code CLI / VSCode ทุก terminal อ่านได้ |
| Persistent User env vars | Claude Desktop subprocess (Cowork worker) inherit เมื่อ launch |

```powershell
.\install-claude-proxy.ps1
```

**Env vars ที่ตั้ง:**

| Var | ค่า |
|---|---|
| `HTTPS_PROXY` | `http://127.0.0.1:8080` |
| `HTTP_PROXY` | `http://127.0.0.1:8080` |
| `NODE_EXTRA_CA_CERTS` | `~/.mitmproxy/mitmproxy-ca-cert.pem` |
| `REQUESTS_CA_BUNDLE` | `~/.mitmproxy/mitmproxy-ca-cert.pem` |
| `SSL_CERT_FILE` | `~/.mitmproxy/mitmproxy-ca-cert.pem` |

**หลังรัน:** ปิด Claude Desktop จาก system tray (Quit) แล้วเปิดใหม่ และเปิด terminal ใหม่

> ถอดได้ด้วย `uninstall-claude-proxy.ps1`

---

### `install-proxy-env.ps1`

**วัตถุประสงค์:** ตั้ง User-level env vars ครบชุดสำหรับ apps ที่ launch จาก Start menu / Shortcuts (ไม่ผ่าน terminal)

ต่างจาก `install-claude-proxy.ps1` ตรงที่ตั้ง env vars เพิ่มเติม:

| Var เพิ่มเติม | ค่า |
|---|---|
| `ALL_PROXY` | `http://127.0.0.1:8080` |
| `NO_PROXY` | `localhost,127.0.0.1,::1,.local` |
| `NODE_USE_SYSTEM_CA` | `1` |

```powershell
# ติดตั้ง
.\install-proxy-env.ps1

# ถอด
.\install-proxy-env.ps1 -Uninstall
```

**หลังรัน:** ปิดทุก app ที่ต้องการให้ inherit env ใหม่

```powershell
# ปิดด่วน
taskkill /F /IM Code.exe ; taskkill /F /IM claude.exe
```

---

### `enable-proxy.ps1`

**วัตถุประสงค์:** เปิด proxy เฉพาะ session PowerShell ปัจจุบัน ไม่กระทบ session อื่น

**ต้อง dot-source** (มี `.` นำหน้า) เพื่อให้ env vars มีผลใน shell ปัจจุบัน:

```powershell
. .\enable-proxy.ps1
```

ใช้เมื่อ:
- ต้องการเปิด Claude Code CLI ใน terminal นั้น: รัน `claude` ต่อได้เลย
- ต้องการเปิด VSCode ผ่าน proxy: รัน `code .` หลัง dot-source

**Env vars ที่ตั้ง (เฉพาะ session):**

| Var | ค่า |
|---|---|
| `HTTPS_PROXY` | `http://127.0.0.1:8080` |
| `HTTP_PROXY` | `http://127.0.0.1:8080` |
| `NODE_EXTRA_CA_CERTS` | `~/.mitmproxy/mitmproxy-ca-cert.pem` |
| `REQUESTS_CA_BUNDLE` | `~/.mitmproxy/mitmproxy-ca-cert.pem` |
| `SSL_CERT_FILE` | `~/.mitmproxy/mitmproxy-ca-cert.pem` |

> ⚠️ ถ้าไม่มี CA cert ที่ `~/.mitmproxy/mitmproxy-ca-cert.pem` script จะหยุดพร้อม error

---

### `disable-proxy.ps1`

**วัตถุประสงค์:** ปิด proxy เฉพาะ session PowerShell ปัจจุบัน

**ต้อง dot-source:**

```powershell
. .\disable-proxy.ps1
```

ล้าง env vars ต่อไปนี้ให้ว่าง (เฉพาะ session นี้):
- `HTTPS_PROXY`
- `HTTP_PROXY`
- `NODE_EXTRA_CA_CERTS`
- `REQUESTS_CA_BUNDLE`
- `SSL_CERT_FILE`

ใช้เมื่อต้องการให้ app ใน terminal นั้นเชื่อมต่อตรงกับ Anthropic โดยไม่ผ่าน proxy ชั่วคราว

---

### `uninstall-claude-proxy.ps1`

**วัตถุประสงค์:** ถอด proxy config ออกจาก Claude tooling แบบถาวร (reverse ของ `install-claude-proxy.ps1`)

```powershell
.\uninstall-claude-proxy.ps1
```

**สิ่งที่ถูกลบ:**

| ที่ | สิ่งที่ลบ |
|---|---|
| `~/.claude/settings.json` | ลบ keys `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` ออกจาก `env` block (keys อื่นยังอยู่) |
| Persistent User env vars | ลบ `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE` |

**หลังรัน:** ปิด Claude Desktop จาก system tray (Quit) แล้วเปิดใหม่

---

## Workflow ทั่วไป

### ตั้งค่าครั้งแรก

```powershell
# 1. รัน mitmproxy ครั้งแรกเพื่อสร้าง cert
mitmdump --listen-port 8080   # Ctrl+C ทันที

# 2. ติดตั้ง cert (Admin)
.\install-cert.ps1

# 3. ตั้ง proxy config ถาวร
.\install-claude-proxy.ps1

# 4. ปิด Claude Desktop แล้วเปิดใหม่
```

### ใช้งานปกติ (ทุกครั้งที่เปิดเครื่อง)

```powershell
# เปิด proxy
.\start.ps1

# ใช้ Claude ได้เลย (ไม่ต้องทำอะไรเพิ่ม ถ้ารัน install-claude-proxy.ps1 แล้ว)
```

### เปิด proxy ชั่วคราวใน terminal

```powershell
. .\enable-proxy.ps1
claude        # หรือ code .
```

### หยุด proxy ชั่วคราว

```powershell
. .\disable-proxy.ps1
```

### ถอนทั้งหมด

```powershell
.\uninstall-claude-proxy.ps1
# แล้วปิด Claude Desktop และเปิดใหม่
```
