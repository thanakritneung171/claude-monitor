# Proxy Setup — คู่มือติดตั้งเฉพาะส่วน Proxy

คู่มือนี้ครอบคลุม **เฉพาะการติดตั้ง mitmproxy + addon.py** สำหรับการดักจับ Claude traffic ในเครื่อง

> สำหรับ Worker + D1 (ฝั่ง backend / dashboard) — ดู [../SETUP.md](../SETUP.md)
> สำหรับโครงสร้างภายใน addon.py + การใช้งานประจำวัน — ดู [README.md](README.md)

---

## ก่อนเริ่ม

### Prerequisites

- **Windows 10/11** (script เป็น `.ps1` — Linux/macOS ดู [../SETUP.md](../SETUP.md) ส่วน macOS/Linux)
- **Python 3.9+** + `pip`
- **PowerShell** (มากับ Windows)
- **สิทธิ์ Administrator** (เฉพาะตอนลง CA cert)
- **Cloudflare Worker URL + API Key** ที่ deploy แล้ว (ถ้ายังไม่มี ดู [../SETUP.md ขั้นตอนที่ 1](../SETUP.md))

### ตรวจ Python ก่อน

```powershell
python --version    # ควรได้ 3.9 หรือสูงกว่า
pip --version
```

ถ้ายังไม่มี Python — ดาวน์โหลดจาก [python.org](https://www.python.org/) และเลือก **"Add to PATH"** ตอน install

---

## ขั้นตอนติดตั้ง

### ขั้นที่ 1 — ติดตั้ง mitmproxy

```powershell
pip install -r proxy\requirements.txt
```

หรือตรงๆ:

```powershell
pip install mitmproxy
```

ตรวจ:

```powershell
mitmdump --version
```

ถ้าเจอ error `mitmdump not found` — Python Scripts directory ยังไม่อยู่ใน PATH:

```powershell
$scripts = "$env:USERPROFILE\AppData\Local\Programs\Python\Python312\Scripts"
$env:PATH += ";$scripts"
# ทำให้ permanent
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH", "User")
```

---

### ขั้นที่ 2 — ตั้ง `config.py`

```powershell
cd proxy
Copy-Item config.example.py config.py
notepad config.py
```

แก้ไขให้ตรงกับ Worker ที่ deploy ไว้:

```python
WORKER_URL = "https://claude-monitor-xxx.<yourname>.workers.dev"
API_KEY    = "<key เดียวกับที่ตั้งใน wrangler secret put API_KEY>"
PROXY_PORT = 8080
```

> ⚠️ `config.py` อยู่ใน `.gitignore` — อย่า commit secret ขึ้น git

---

### ขั้นที่ 3 — สร้าง CA Certificate

mitmproxy สร้าง self-signed CA ครั้งแรกที่รัน:

```powershell
mitmdump --listen-port 8080
```

รอเห็น log:

```
Proxy server listening at *:8080
```

แล้วกด **Ctrl+C** ทันที (ตอนนี้ยังไม่ต้องใช้ proxy — แค่ต้องการสร้าง cert)

ตรวจว่ามี cert:

```powershell
Test-Path "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"
# ควรได้ True
```

---

### ขั้นที่ 4 — ลง CA Cert ลง Trusted Root (Run as Admin)

**เปิด PowerShell แบบ Run as Administrator** แล้วรัน:

```powershell
proxy\install-cert.ps1
```

หรือถ้าอยาก install ด้วยมือ:

```powershell
Import-Certificate `
  -FilePath "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem" `
  -CertStoreLocation Cert:\CurrentUser\Root
```

ตรวจสอบ:

```powershell
Get-ChildItem Cert:\CurrentUser\Root\* | Where-Object Subject -like "*mitmproxy*"
```

ควรเจอ entry ที่ Subject มี `mitmproxy`

---

### ขั้นที่ 5 — ตั้งค่า Environment Variables

มี 3 script ให้เลือก ขึ้นกับว่าต้องการให้ env มีผลกว้างแค่ไหน:

| Script | Scope | เมื่อไรใช้ |
|---|---|---|
| `enable-proxy.ps1` | session ปัจจุบัน (dot-source) | ทดสอบเฉพาะ shell ปัจจุบันเท่านั้น |
| `install-proxy-env.ps1` | User-level permanent | VSCode / CLI ที่เปิดจาก Start menu inherit ได้ |
| **`install-claude-proxy.ps1`** ⭐ | User env + `~/.claude/settings.json` | **แนะนำ** — ครอบคลุม Claude Desktop + Cowork worker subprocess + Code CLI/VSCode |

**วิธีที่แนะนำ — รันแค่อันเดียว:**

```powershell
proxy\install-claude-proxy.ps1
```

Script นี้จะตั้งให้:

1. **`~/.claude/settings.json`** มี block:
   ```json
   {
     "env": {
       "HTTPS_PROXY": "http://127.0.0.1:8080",
       "HTTP_PROXY":  "http://127.0.0.1:8080",
       "NODE_EXTRA_CA_CERTS": "C:\\Users\\<you>\\.mitmproxy\\mitmproxy-ca-cert.pem"
     }
   }
   ```
2. **User-level env vars** (permanent):
   - `HTTPS_PROXY`, `HTTP_PROXY` → `http://127.0.0.1:8080`
   - `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE` → path CA cert

ตรวจสอบ:

```powershell
[Environment]::GetEnvironmentVariable('HTTPS_PROXY', 'User')
[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS', 'User')
```

---

### ขั้นที่ 6 — เริ่ม proxy

```powershell
proxy\start.ps1
```

`start.ps1` จะเรียก:

```
mitmdump -s addon.py --listen-port 8080 -q --allow-hosts "(anthropic\.com|claude\.ai|claudeusercontent\.com)"
```

ปล่อยให้มันรันค้างไว้ ทุกครั้งที่ใช้ Claude tools ต้องมี proxy รันอยู่

console ควรเห็น (ตอนเริ่ม):

```
[claude-monitor] email filter OFF — logging all accounts

  Claude Monitor
  -------------------------------------
  Proxy  : http://127.0.0.1:8080
  Target : https://api.anthropic.com
```

---

### ขั้นที่ 7 — ปิด-เปิด Claude Clients ใหม่

**สำคัญที่สุด** — process ที่เปิดอยู่ก่อนตั้ง env ยังใช้ env เดิม **ไม่ inherit ค่าใหม่**

```powershell
taskkill /F /IM Code.exe ; taskkill /F /IM claude.exe ; taskkill /F /IM Claude.exe
```

> Claude Desktop: ปิดจาก **system tray → Quit** ไม่ใช่แค่ปิดหน้าต่าง — ไม่งั้น background process ยังเดิมอยู่

จากนั้นเปิดทุกอย่างใหม่จาก Start menu / desktop shortcut ก็พอ — env vars ที่เป็น User-level จะ inherit อัตโนมัติ

---

### ขั้นที่ 8 — ทดสอบ

#### ทดสอบ Claude Code CLI

```powershell
claude
> ทดสอบ neung 2230
> /exit
```

ตรวจ log:

```powershell
Get-Content "log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl" | Select-Object -Last 1
```

ควรเห็น entry มี `"client": "claude-code-cli"` และ `total_tokens` > 0

#### ทดสอบ Claude Code VSCode

ปิด VSCode ทุกตัวก่อน แล้วเปิดใหม่ (จาก Start menu ก็ได้) — ส่ง prompt ใน Claude Code extension

ตรวจ log: ควรเห็น `"client": "claude-code-vscode"`

#### ทดสอบ Claude Desktop Chat

เปิด Claude Desktop → Chat tab → ส่ง prompt

ตรวจ log: ควรเห็น `"client": "claude-desktop"`

#### ทดสอบ Cowork (ถ้าใช้)

Claude Desktop → Cowork tab → ส่ง prompt

ตรวจ log: ควรเห็น `"client": "claude-desktop-cowork"`

---

## สรุปคำสั่ง — Quick Reference

```powershell
# === ติดตั้งครั้งแรก ===
pip install -r proxy\requirements.txt           # 1. install mitmproxy
Copy-Item proxy\config.example.py proxy\config.py
notepad proxy\config.py                          # 2. ใส่ WORKER_URL + API_KEY
mitmdump --listen-port 8080                      # 3. รันครั้งเดียวเพื่อสร้าง CA cert (Ctrl+C)
# 4. PowerShell as Admin →
proxy\install-cert.ps1                           #    ลง CA cert
proxy\install-claude-proxy.ps1                   # 5. ตั้ง env + Claude settings
taskkill /F /IM Code.exe                         # 6. ปิด client เก่า
taskkill /F /IM claude.exe
proxy\start.ps1                                  # 7. เริ่ม proxy
# 8. เปิด Claude tools ใหม่ → ทดสอบ

# === ใช้งานประจำวัน ===
proxy\start.ps1                                  # เริ่ม proxy (Ctrl+C เพื่อหยุด)
Get-Content "log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl" -Wait -Tail 5
                                                 # ดู log แบบสด

# === ลบออก ===
proxy\uninstall-claude-proxy.ps1                 # ล้าง env + settings.json
```

---

## ตรวจสอบหลังติดตั้ง — Checklist

- [ ] `mitmdump --version` → ขึ้นเวอร์ชัน
- [ ] `proxy\config.py` มี `WORKER_URL` + `API_KEY` ที่ถูกต้อง
- [ ] `Test-Path "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"` → True
- [ ] `Get-ChildItem Cert:\CurrentUser\Root\* | ? Subject -like "*mitmproxy*"` → เจอ
- [ ] `[Environment]::GetEnvironmentVariable('HTTPS_PROXY','User')` → `http://127.0.0.1:8080`
- [ ] `[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','User')` → path .pem
- [ ] `Test-Path "$env:USERPROFILE\.claude\settings.json"` → True (มี env block)
- [ ] `proxy\start.ps1` รันได้ — ขึ้น `Proxy : http://127.0.0.1:8080`
- [ ] หลังส่ง prompt มี entry ใหม่ใน `log\claude_<วันนี้>.jsonl`

---

## ปัญหาที่พบบ่อย (สั้น)

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `mitmdump not found` | Python Scripts ไม่อยู่ใน PATH | ดูขั้นที่ 1 |
| `unable to verify the first certificate` | CA cert ไม่ trust | ทำขั้นที่ 4 ใหม่ (Run as Admin) |
| log ไม่ขึ้นเลย | client เก่ายังใช้ env เดิม | ขั้นที่ 7 — ปิด-เปิดใหม่ |
| Cowork ไม่ขึ้น log แต่ Chat ขึ้น | Cowork subprocess ต้อง User-level env | run `install-claude-proxy.ps1` (ไม่ใช่ `enable-proxy.ps1`) |
| Worker คืน 401 | API_KEY ไม่ตรง | `wrangler secret put API_KEY` ใหม่ |
| client เป็น `api` แทน `claude-code-cli` | header ถูก strip | ดูใน [README.md — body override](README.md) |
| 400 — `oneOf, allOf, or anyOf at the top level` | tool schema เสีย | `ToolSchemaFixer` ใน addon.py จัดการให้ — ดู [README.md — Troubleshooting](README.md) |

ปัญหาแบบละเอียดกว่านี้ + diagnostic commands → [README.md ส่วน Troubleshooting](README.md)

---

## ลบออกทั้งหมด

```powershell
# ล้าง env + settings.json
proxy\uninstall-claude-proxy.ps1

# ลบ Trusted Root cert (optional)
Get-ChildItem Cert:\CurrentUser\Root\* |
  Where-Object Subject -like "*mitmproxy*" |
  Remove-Item

# ลบ mitmproxy folder (optional)
Remove-Item "$env:USERPROFILE\.mitmproxy" -Recurse

# uninstall mitmproxy (optional)
pip uninstall mitmproxy

# ปิด-เปิดทุก Claude client เพื่อให้ต่างๆ คืนเป็นปกติ
taskkill /F /IM Code.exe ; taskkill /F /IM claude.exe ; taskkill /F /IM Claude.exe
```

---

## ลิงก์ที่เกี่ยวข้อง

- [README.md](README.md) — โครงสร้างภายใน addon.py + การใช้งานประจำวัน + troubleshooting แบบละเอียด
- [../README.md](../README.md) — ภาพรวมระบบทั้ง stack
- [../SETUP.md](../SETUP.md) — install ทั้ง stack (Worker + D1 + Proxy)
- [../DEVELOPER.md](../DEVELOPER.md) — internals สำหรับเพิ่มฟีเจอร์
