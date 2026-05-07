# Docker Proxy — การติดตั้งและใช้งาน

proxy รัน mitmproxy ใน Docker container แทนที่จะติดตั้ง Python/mitmproxy บนเครื่องโดยตรง  
config ทั้งหมดส่งผ่าน environment variables ใน `.env`

---

## Prerequisites

| Tool | Version |
|---|---|
| Docker Desktop | 4.0+ |
| Docker Compose | v2 (built-in กับ Docker Desktop) |
| Cloudflare Worker | ต้อง deploy ก่อน (ดู README หลัก) |

---

## 1. สร้าง `.env` file

```powershell
cp .env.example .env
```

แก้ไข `.env`:

```env
WORKER_URL=https://claude-monitor-hooks.<yourname>.workers.dev
API_KEY=your-secret-key

PROXY_PORT=8080
```

> `API_KEY` ต้องตรงกับ `wrangler secret put API_KEY` ที่ตั้งบน Worker

---

## 2. Build และ Start container

```powershell
.\docker\start.ps1
```

script จะ build image และ start container ให้อัตโนมัติ พร้อมแสดง next steps

ดู log แบบ real-time:

```powershell
docker compose logs -f
```

---

## 3. ติดตั้ง CA Certificate (ครั้งแรกครั้งเดียว)

mitmproxy สร้าง CA cert ของตัวเองตอน start ครั้งแรก cert เก็บอยู่ใน Docker volume  
ต้อง copy ออกมาติดตั้งบน Windows ก่อนที่ browser/app จะเชื่อถือการ intercept ได้

รัน script ต่อไปนี้ใน **PowerShell (Administrator)**:

```powershell
.\docker\install-cert.ps1
```

script จะทำทุกขั้นตอนให้อัตโนมัติ:
1. ตรวจว่า container รันอยู่ (start ให้ถ้ายังไม่ได้รัน)
2. Copy cert จาก container ไปที่ `~\.mitmproxy\`
3. ติดตั้ง cert เข้า Windows Trusted Root ด้วย `certutil`

> ต้องทำซ้ำถ้าลบ volume `mitmproxy-certs` เพราะ cert จะถูก regenerate

---

## 4. เปิด System Proxy

```powershell
.\docker\enable-proxy.ps1
```

script นี้ตั้ง environment variables ต่อไปนี้แบบ persistent (User scope):

| Variable | Value |
|---|---|
| `HTTPS_PROXY` | `http://127.0.0.1:8080` |
| `HTTP_PROXY` | `http://127.0.0.1:8080` |
| `NODE_EXTRA_CA_CERTS` | path ของ CA cert |
| `SSL_CERT_FILE` | path ของ CA cert |

และเขียน proxy config เข้า `~/.claude/settings.json` สำหรับ Claude Code

**Restart Claude Desktop / VSCode / Terminal** หลังรัน script นี้

---

## 5. ตรวจสอบว่า proxy ทำงาน

เปิด Dashboard: `https://claude-monitor-hooks.<yourname>.workers.dev`

หรือดู log ใน container:

```powershell
docker compose logs -f
```

หรือดู local log file ใน `./log/` directory (mount จาก container):

```powershell
Get-Content .\log\claude_$(Get-Date -Format 'yyyy-MM-dd').jsonl -Tail 10
```

---

## Common Commands

| Action | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| View logs | `docker compose logs -f` |
| Rebuild image | `docker compose up -d --build` |
| Shell เข้า container | `docker exec -it claude-monitor-proxy bash` |

---

## Email Filter (Optional)

เพิ่มใน `.env` แล้ว restart container:

```env
EMAIL_FILTER_ENABLED=true
EMAIL_FILTER_SUBSTRING=@yourcompany.com
```

```powershell
docker compose restart
```

เมื่อเปิด — เฉพาะ call จาก email ที่มี substring นี้จะถูก log ส่วน call ที่ไม่มี email (API key users) จะถูก drop

---

## ปิด Proxy

```powershell
# หยุด container
.\docker\stop.ps1

# ถอด system proxy
.\docker\disable-proxy.ps1
```

---

## Troubleshooting

**Container ไม่ healthy**

```powershell
docker compose logs mitmproxy
```

สาเหตุที่พบบ่อย:
- Port 8080 ถูก process อื่นใช้อยู่ → `netstat -ano | findstr :8080`
- `.env` ไม่มี `WORKER_URL` หรือ `API_KEY`

**SSL Error / Certificate not trusted**

- ตรวจว่าทำ step 3 (copy + install cert) แล้ว
- ต้อง copy cert ใหม่ถ้า recreate container จาก fresh volume
- ลองรัน `install-cert.ps1` ซ้ำในฐานะ Administrator

**ไม่เห็น log ใน Dashboard**

- ตรวจ `WORKER_URL` และ `API_KEY` ใน `.env` ว่าตรงกับ Worker
- ดู container logs หาบรรทัด `[ERROR]` หรือ HTTP status จาก Worker

**Logs ไม่บันทึกลง `./log/`**

- ตรวจว่า `./log/` directory มีอยู่ (docker compose สร้างให้อัตโนมัติ)
- ดู volume mapping: `docker inspect claude-monitor-proxy | findstr log`

---

## Volume และ Data

| Volume | เก็บอะไร |
|---|---|
| `mitmproxy-certs` (named volume) | CA cert ของ mitmproxy — persistent ข้ามการ restart |
| `./log` (bind mount) | JSONL log files — อยู่บน host machine |

ลบ named volume (cert จะถูก regenerate ครั้งถัดไป):

```powershell
docker compose down -v
```

> ถ้าลบ volume ต้องทำ step 3 ใหม่ (copy + install cert)
