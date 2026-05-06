# Prerequisites for Docker Setup

## ต้องตรวจสอบก่อนเริ่ม

### 1. Docker Desktop ติดตั้งแล้วหรือ?

```powershell
docker --version
```

ถ้า error: ดาวน์โหลด [Docker Desktop](https://www.docker.com/products/docker-desktop)

### 2. Docker daemon ทำงานอยู่หรือ?

```powershell
docker ps
```

ถ้า error: เปิด Docker Desktop (ต้องทำให้ daemon เริ่มทำงาน)

### 3. docker-compose ติดตั้งแล้วหรือ?

```powershell
docker-compose --version
```

ถ้า error: ติดตั้ง: `docker-compose` มาแล้วในชุด Docker Desktop

### 4. .env file ตั้งค่าแล้วหรือ?

```powershell
# ตรวจสอบ
cat .env
```

ถ้าไม่มี หรือมี default values:

```powershell
# Copy template
cp .env.example .env

# Edit .env ด้วย editor โปรดปรานของคุณ
notepad .env
```

**ต้องกรอก:**
- `WORKER_URL` = URL ของ Cloudflare Worker (เช่น `https://your-worker.workers.dev`)
- `API_KEY` = Secret key สำหรับ authentication

---

## Checklist

- [ ] `docker --version` ให้ผลลัพธ์ (Docker ติดตั้ง)
- [ ] `docker ps` ทำงาน (Docker daemon ทำงาน)
- [ ] `docker-compose --version` ให้ผลลัพธ์
- [ ] `.env` มีค่า `WORKER_URL` และ `API_KEY` ที่ถูกต้อง

---

## Ready!

เมื่อครบทั้งหมด ลองรัน:

```powershell
# Windows
.\setup.cmd

# Linux/macOS
bash start-docker.sh
```

---

## Troubleshooting

| ปัญหา | วิธีแก้ |
|---|---|
| `docker: command not found` | ติดตั้ง Docker Desktop |
| `Cannot connect to Docker daemon` | เปิด Docker Desktop (ต้องทำให้มันทำงาน) |
| `permission denied` | เพิ่ม user เข้า docker group: `sudo usermod -aG docker $USER` (Linux) |
| `Dockerfile not found` | ลืม clone/copy ไฟล์ มาตรวจสอบว่า `Dockerfile` อยู่ใน root |
| `.env` file errors | ตรวจสอบ syntax ใน `.env` ไม่มี syntax errors |

---

เมื่อทุกอย่างพร้อม: [DOCKER_QUICK_START.md](DOCKER_QUICK_START.md)
