# คู่มือติดตั้งและใช้งาน 🚀

## สิ่งที่ต้องมีก่อน

- **Python 3.9+** พร้อม pip
- **Cloudflare Account** ที่เปิดใช้ Workers และ D1
- **mitmproxy 9.0+**
- **Node.js + npm** (สำหรับ deploy Worker)

---

## ขั้นตอนที่ 1: ตั้งค่า Cloudflare Worker

### 1a. สร้าง D1 Database

```bash
cd worker
wrangler d1 create claude-monitor
```

คำสั่งนี้จะคืน database ID เช่น `12345678-1234-1234-1234-123456789012` — จดไว้

### 1b. สร้างตาราง

```bash
wrangler d1 execute claude-monitor --remote --command="
CREATE TABLE IF NOT EXISTS api_logs (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  client TEXT,
  account_email TEXT,
  machine_name TEXT,
  model TEXT,
  prompt TEXT,
  prompt_chars INTEGER,
  response_chars INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_ts    ON api_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_model ON api_logs(model);
CREATE INDEX IF NOT EXISTS idx_email ON api_logs(account_email);
"
```

### 1c. แก้ไข wrangler.toml

```toml
name = "claude-monitor"
main = "src/index.ts"
compatibility_date = "2024-11-21"

[[d1_databases]]
binding = "DB"
database_id = "YOUR_DATABASE_ID"   # ← ใส่ ID จากขั้นตอน 1a
database_name = "claude-monitor"
```

### 1d. ตั้งค่า API Key

```bash
wrangler secret put API_KEY
# พิมพ์ key ที่ต้องการ (ตัวอักษรสุ่มอะไรก็ได้ เช่น MySecretKey123)
```

### 1e. Deploy Worker

```bash
cd worker
npm install
npm run deploy
```

จะได้ URL เช่น: `https://claude-monitor-abc123.your-account.workers.dev`

---

## ขั้นตอนที่ 2: ตั้งค่า mitmproxy Addon

### 2a. คัดลอก config

```bash
cd proxy
cp config.example.py config.py
```

### 2b. แก้ไข config.py

```python
WORKER_URL = "https://claude-monitor-abc123.your-account.workers.dev"
API_KEY    = "MySecretKey123"   # ← ต้องตรงกับที่ตั้งใน Step 1d
PROXY_PORT = 8080
```

---

## ขั้นตอนที่ 3: ตั้งค่า System Proxy

mitmproxy ต้องการเป็น proxy ของระบบเพื่อดักจับ HTTPS traffic

### Windows

#### วิธีที่ 1: ใช้ Script ที่มีให้ (แนะนำ)

```powershell
# เปิด proxy
.\proxy\enable-proxy.ps1

# เปิด mitmproxy
mitmdump -s proxy/addon.py --listen-port 8080

# ปิด proxy เมื่อเสร็จ
.\proxy\disable-proxy.ps1
```

#### วิธีที่ 2: ตั้งมือ

1. ไปที่ **Settings → Network & Internet → Proxy**
2. เปิด **Use a proxy server** → ON
3. ใส่ Address: `127.0.0.1` Port: `8080`
4. กด Save

### macOS

```bash
# เปิด proxy
networksetup -setwebproxy "Wi-Fi" 127.0.0.1 8080
networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 8080

# เปิด mitmproxy
mitmdump -s proxy/addon.py --listen-port 8080

# ปิด proxy เมื่อเสร็จ
networksetup -setwebproxystate "Wi-Fi" off
networksetup -setsecurewebproxystate "Wi-Fi" off
```

### Linux

```bash
export http_proxy=http://127.0.0.1:8080
export https_proxy=http://127.0.0.1:8080
```

---

## ขั้นตอนที่ 4: ติดตั้ง mitmproxy Certificate

mitmproxy ต้องใช้ HTTPS MITM จึงต้องติดตั้ง CA certificate

### Windows (PowerShell Admin)

```powershell
Import-Certificate `
  -FilePath "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem" `
  -CertStoreLocation Cert:\CurrentUser\Root
```

### macOS

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  ~/.mitmproxy/mitmproxy-ca-cert.pem
```

### Linux

```bash
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

> **หมายเหตุ:** ไฟล์ certificate อยู่ที่ `~/.mitmproxy/` หลังจากรัน mitmproxy ครั้งแรก

---

## ขั้นตอนที่ 5: เปิดใช้งาน

### เปิด mitmproxy

```bash
cd proxy
mitmdump -s addon.py --listen-port 8080 --allow-hosts "claude.ai|api.anthropic.com"
```

**ผลลัพธ์ที่ควรเห็น:**

```
[claude-account] ✓ detected email: your-email@example.com (from /api/auth/current_account)
[claude-api] claude-code | claude-3.5-sonnet-20241022 | in=1,234 out=567 | $0.00123 | claude_2024-12-19.jsonl
[claude-desktop] claude-3-opus-20240229 | prompt=156ch | in=2,345 out=890 | $0.00567 | claude_2024-12-19.jsonl
```

### เปิด Dashboard

เปิดเบราว์เซอร์ไปที่ Worker URL:

```
https://claude-monitor-abc123.your-account.workers.dev/
```

Dashboard จะ refresh ทุก 15 วินาที

---

## ทดสอบระบบ

### ทดสอบกับ Claude Desktop

1. เปิด Claude Desktop
2. พิมพ์ข้อความอะไรก็ได้
3. ดู mitmproxy console — ควรเห็น:
   ```
   [claude-desktop] claude-3-sonnet-20241022 | prompt=145ch | in=1,567 out=789 | $0.00234
   ```
4. เปิด Dashboard — ควรเห็น log ใหม่ปรากฏ

### ทดสอบกับ Claude Code

1. เปิด VSCode + Claude Code extension
2. สั่งงาน Claude Code
3. ดูใน mitmproxy:
   ```
   [claude-api] claude-code | claude-3.5-sonnet-20241022 | in=892 out=456 | $0.00123
   ```

### ทดสอบกับ API โดยตรง

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: sk-ant-..." \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-3-sonnet-20241022", "max_tokens": 100, "messages": [{"role": "user", "content": "สวัสดี"}]}'
```

---

## แก้ปัญหาที่พบบ่อย

### Claude Desktop เชื่อมต่อไม่ได้

**สาเหตุ:** Certificate ไม่ถูก trust หรือ proxy ไม่ทำงาน

**วิธีแก้:**
1. ตรวจว่า mitmproxy รันอยู่: `netstat -an | findstr 8080`
2. ติดตั้ง certificate ใหม่ (ขั้นตอนที่ 4)
3. Restart Claude Desktop
4. ตรวจ Firewall ว่าไม่บล็อก port 8080

### เห็น "Worker returned 401" ใน mitmproxy

**สาเหตุ:** API key ใน config.py ไม่ตรงกับ Worker

**วิธีแก้:**
```bash
# อัปเดต secret ใน Worker
cd worker
wrangler secret put API_KEY
# พิมพ์ key เดิมที่ใช้ใน config.py
npm run deploy
```

### ไม่มีข้อมูลใน Dashboard

**สาเหตุ:** log ไม่ถึง Worker

**วิธีแก้:**
1. ทดสอบ Worker: `curl https://your-worker.workers.dev/health`
2. ดู error ใน mitmproxy console
3. ตรวจว่าใช้ `--allow-hosts` ถูก
4. ตรวจตาราง D1: `wrangler d1 execute claude-monitor --remote --command "SELECT COUNT(*) FROM api_logs"`

### addon โหลดไม่ได้

```bash
# ตรวจ syntax
python -m py_compile proxy/addon.py

# ติดตั้ง dependency
pip install mitmproxy
```

---

## คำสั่งที่มีประโยชน์

### ดู log ในเครื่อง

```bash
# ดู log ล่าสุด
tail -f log/claude_2024-12-19.jsonl

# นับจำนวน call ต่อ model
# Linux/macOS:
jq -r '.model' log/claude_*.jsonl | sort | uniq -c
```

### Query D1 โดยตรง

```bash
# ค่าใช้จ่ายรวม
wrangler d1 execute claude-monitor --remote --command \
  "SELECT SUM(cost_usd) as total_cost FROM api_logs"

# สรุปตาม model
wrangler d1 execute claude-monitor --remote --command \
  "SELECT model, COUNT(*) as calls, SUM(cost_usd) as cost FROM api_logs GROUP BY model"

# 10 call ล่าสุด
wrangler d1 execute claude-monitor --remote --command \
  "SELECT ts, client, model, total_tokens, cost_usd FROM api_logs ORDER BY ts DESC LIMIT 10"
```

### ลบ log เก่า

```bash
# ลบ log เก่ากว่า 30 วัน
wrangler d1 execute claude-monitor --remote --command \
  "DELETE FROM api_logs WHERE ts < (strftime('%s', 'now', '-30 days') * 1000)"
```

### ดู Worker logs แบบ real-time

```bash
wrangler tail
```

---

## โครงสร้างไฟล์

```
claude-monitor/
├── proxy/
│   ├── addon.py              # mitmproxy addon หลัก
│   ├── config.py             # ตั้งค่า (ต้องสร้างเอง)
│   ├── config.example.py     # template ตัวอย่าง
│   ├── enable-proxy.ps1      # เปิด proxy Windows
│   ├── disable-proxy.ps1     # ปิด proxy Windows
│   └── start.ps1             # เริ่มระบบ Windows
├── worker/
│   ├── src/index.ts          # Cloudflare Worker
│   ├── wrangler.toml         # Worker config
│   └── package.json
├── log/                      # JSONL logs (สร้างอัตโนมัติ)
├── README.md                 # อธิบายระบบ
├── SETUP.md                  # คู่มือนี้
└── DEVELOPER.md              # คู่มือนักพัฒนา
```
