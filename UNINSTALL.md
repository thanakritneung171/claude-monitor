# คู่มือถอนการติดตั้ง Claude Monitor

ขั้นตอนนี้จะคืน Claude Desktop / Code / CLI กลับสู่การเชื่อมต่อตรงกับ Anthropic โดยไม่ผ่าน proxy

---

## ขั้นตอนที่ 1: หยุด mitmproxy

ถ้ากำลังรัน `start.ps1` อยู่ กด **Ctrl+C** ในหน้าต่าง PowerShell นั้น

---

## ขั้นตอนที่ 2: ถอด Proxy Config (Windows)

### เครื่องพนักงาน (ติดตั้งจากแพ็กเกจ `install-SDBAIInsight`)

ดับเบิลคลิก `uninstall-claude-proxy.bat` (อยู่ในแพ็กเกจ และที่ `proxy/uninstall-claude-proxy.bat`) — ลบเฉพาะค่าที่ยังเป็นของเรา ค่าที่ user / IT ตั้งเองไม่แตะ:

| สิ่งที่ถูกลบ / คืนค่า | เงื่อนไข |
|---|---|
| Windows PAC (`AutoConfigURL` = `.../proxy.pac`) | ลบ — ถ้าก่อนติดตั้งมีที่อยู่ setup script อื่นเก็บไว้ (ปิดอยู่) คืนที่อยู่เดิมให้ และเปิด "Automatically detect settings" คืนถ้า installer เป็นคนปิด (ค่าสำรองอยู่ที่ `HKCU\Software\SDBAIInsight`) |
| system proxy แบบจับทุก host `10.10.84.1:8081` (installer รุ่นเก่า) | ปิด + ล้าง `ProxyServer` (และ `ProxyOverride` ถ้ายังเป็นรายการเดิมของเรา) |
| `~/.claude/settings.json` — `env` | `HTTPS_PROXY`/`HTTP_PROXY` ที่ชี้ 10.10.84.1: คืนค่าเดิมของ user ถ้ามี ไม่งั้นลบ · `NO_PROXY`: คืนค่าเดิม หรือลบเฉพาะรายการของเรา · `NODE_EXTRA_CA_CERTS` ที่ชี้ CA ของเรา: ลบ |
| user env vars (installer รุ่นเก่า) | ลบ `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE` เมื่อค่ายังเป็นของเรา |
| ไฟล์ `~/.claude/sdb-ai-insight-ca.pem`, autostart `ClaudeMonitorPacServer` + `~/.claude/claude-proxy.pac` (branch เก่า) | ลบ |

CA ใน Windows store (`install-mitmproxy-cert.bat`) ไม่ถูกลบ — ลบเองได้ที่ `certmgr.msc` → Trusted Root → `mitmproxy`

### เครื่อง dev (สคริปต์ .ps1)

```powershell
cd proxy
.\uninstall-claude-proxy.ps1
```

Script นี้ทำ 2 อย่างอัตโนมัติ:

| สิ่งที่ถูกลบ | รายละเอียด |
|---|---|
| `~/.claude/settings.json` — `env` block | ลบ `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS` |
| Persistent user env vars | ลบ `HTTPS_PROXY`, `HTTP_PROXY`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `SSL_CERT_FILE` |

> หลังรัน: ปิด Claude Desktop จาก system tray (Quit) แล้วเปิดใหม่ เพื่อให้ subprocess ได้ env ใหม่

### macOS / Linux

ลบหรือ comment บรรทัดต่อไปนี้ออกจาก `~/.bashrc` หรือ `~/.zshrc`:

```bash
# ลบบรรทัดเหล่านี้ออก
export HTTPS_PROXY=http://127.0.0.1:8080
export HTTP_PROXY=http://127.0.0.1:8080
export NODE_EXTRA_CA_CERTS=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export REQUESTS_CA_BUNDLE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
export SSL_CERT_FILE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem
```

แล้ว reload shell:

```bash
source ~/.bashrc   # หรือ source ~/.zshrc
```

---

## ขั้นตอนที่ 3: ลบ CA Certificate

### Windows (PowerShell Admin)

```powershell
# ค้นหา cert ของ mitmproxy
Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -like "*mitmproxy*" }

# ลบออก (ใช้ Thumbprint จากคำสั่งข้างบน)
Remove-Item "Cert:\CurrentUser\Root\<THUMBPRINT>"
```

หรือผ่าน GUI:

1. เปิด **certmgr.msc** (Run → `certmgr.msc`)
2. ไปที่ **Trusted Root Certification Authorities** → Certificates
3. หา `mitmproxy` → คลิกขวา → Delete

### macOS

```bash
sudo security delete-certificate -c "mitmproxy" /Library/Keychains/System.keychain
```

### Linux

```bash
sudo rm /usr/local/share/ca-certificates/mitmproxy-ca-cert.pem
sudo update-ca-certificates
```

---

## ขั้นตอนที่ 4: (ถ้าต้องการ) ลบ Local Log Files

```powershell
Remove-Item "log\*.jsonl" -Force
```

หรือลบทั้งโฟลเดอร์ `log/`:

```powershell
Remove-Item "log" -Recurse -Force
```

---

## ตรวจสอบว่าถอนสำเร็จ

```powershell
# ตรวจว่า env vars หายแล้ว (ควรคืนค่าว่าง)
$env:HTTPS_PROXY
[Environment]::GetEnvironmentVariable("HTTPS_PROXY", "User")

# ตรวจว่า settings.json ไม่มี proxy แล้ว
Get-Content "$env:USERPROFILE\.claude\settings.json"

# ตรวจว่า cert ถูกลบแล้ว
Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -like "*mitmproxy*" }
```

หลังถอนสำเร็จ Claude Desktop / Code / CLI จะกลับไปเชื่อมต่อตรงกับ Anthropic โดยไม่ผ่าน proxy

---

## ติดตั้งใหม่

ถ้าต้องการเปิดใช้งานอีกครั้ง ดู [SETUP.md](SETUP.md)
