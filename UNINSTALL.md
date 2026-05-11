# คู่มือถอนการติดตั้ง Claude Monitor

ขั้นตอนนี้จะคืน Claude Desktop / Code / CLI กลับสู่การเชื่อมต่อตรงกับ Anthropic โดยไม่ผ่าน proxy

---

## ขั้นตอนที่ 1: หยุด mitmproxy

ถ้ากำลังรัน `start.ps1` อยู่ กด **Ctrl+C** ในหน้าต่าง PowerShell นั้น

---

## ขั้นตอนที่ 2: ถอด Proxy Config (Windows)

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
