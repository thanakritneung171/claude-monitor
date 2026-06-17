# Worker Structure — แผนผังโครงสร้างไฟล์ (ปัจจุบัน)

`worker/src/` แตกตามความรับผิดชอบ: `index.ts` เป็น **route dispatcher** ล้วน แล้ว delegate ไป `routes/` (handler) · `db/` (SQL) · `lib/` (pure helpers) · `views/` (HTML/CSS/JS + render)

> เดิมเอกสารนี้เป็น "แผน refactor" จาก index.ts ไฟล์เดียว — ตอนนี้ทำเสร็จและขยายเป็นหลาย route แล้ว

---

## โครงสร้างปัจจุบัน

```
worker/src/
├── index.ts                  # route dispatch เท่านั้น — เห็น endpoint ทั้งหมดในที่เดียว
├── types.ts                  # ApiLog, Filters, Env
│
├── routes/                   # 1 ไฟล์ = 1 endpoint group
│   ├── log.ts                # POST /log  (ingest + upsertEmailIdentity)
│   ├── health.ts             # GET /health
│   ├── auth.ts               # /login, /logout, /api/me, OAuth callback (Logto)
│   ├── dashboard.ts          # GET /        (KPI + recent calls)
│   ├── logs.ts               # GET /logs    (full-field table + filter + pagination)
│   ├── analytics.ts          # GET /analytics (trend chart + Export PDF)
│   ├── accounts.ts           # GET /accounts
│   ├── account-detail.ts     # GET /account?identity=<email>
│   ├── identity.ts           # GET /identity (frozen) + /new-identity (canonical)
│   ├── insights.ts           # GET /insights
│   ├── reports.ts            # GET /reports
│   ├── monitoring.ts         # GET /monitoring
│   ├── data-sources.ts       # GET /data-sources
│   ├── export.ts             # GET /export  (CSV / XLSX)
│   ├── settings.ts           # GET /settings + POST key-rotate / notifications
│   └── clear-data.ts         # GET/POST /clear-data
│
├── db/
│   ├── queries.ts            # SQL หลัก (list, count, totals, byModel/Client/Account/Machine)
│   ├── queries-extra.ts      # SQL ของหน้า analytics/insights/identity ฯลฯ
│   └── filters.ts            # buildWhere(), normalizeClient()
│
├── lib/
│   ├── auth.ts               # requireUser(), Logto OIDC helpers (ใช้ jose)
│   ├── account.ts            # upsertEmailIdentity() + identity helpers
│   ├── format.ts             # esc, num, json, fmtBkk*
│   ├── date.ts               # todayBkk, firstOfMonthBkk, dateToMs ฯลฯ
│   ├── badge.ts              # modelBadge, clientBadge, accountBadge
│   ├── csv.ts                # toCsv()
│   ├── xlsx.ts               # XLSX export (ใช้ fflate)
│   └── logo.ts               # โลโก้ฝัง base64 สำหรับ PDF/print
│
└── views/                    # *.html + *.css + *.client.js + *.ts (render)
    ├── layout.ts             # shell ร่วม (sidebar + head)
    ├── sidebar.html/.css/.client.js
    ├── shared.css
    ├── dashboard.*           # html/css/client.js/ts
    ├── logs.ts · analytics.* · accounts.* · account-detail.*
    ├── identity.ts · new-identity.ts
    ├── insights.* · reports.* · monitoring.* · data-sources.*
    ├── settings.* · clear-data.*
    └── image/                # โลโก้ softdebut (png/webp + base64)
```

---

## หลักการแยกไฟล์

- **`index.ts` = dispatcher** — `if (pathname === '/x') return handleX(...)` เรียงตาม public → authenticated
- **เพิ่ม route ใหม่** = สร้างไฟล์ใน `routes/` + (ถ้าต้องการ) view ใน `views/` + register 1 บรรทัดใน `index.ts`
- **view แบบ text-import** — `.html`/`.css`/`.client.js` ถูก import เป็น string ผ่าน `rules` ใน `wrangler.jsonc`:

```jsonc
"rules": [ { "type": "Text", "globs": ["**/*.html", "**/*.css", "**/*.client.js"], "fallthrough": true } ]
```

  และมี module declaration ใน `assets.d.ts`

- **render pattern** — view `.ts` โหลด html/css/client.js แล้ว `.replace('{{placeholder}}', ...)`

---

## ข้อดีของโครงสร้างนี้

- เห็น route ทั้งหมดใน `index.ts` ไฟล์เดียว
- แก้ CSS/HTML ได้โดยไม่ต้องเปิดไฟล์ logic — editor ให้ syntax highlight เต็มที่
- backend (`POST /log`) แยกชัดจากโค้ด render
- test helper แยกได้ง่าย · Worker ยัง bundle เดียวเหมือนเดิม (deploy ขนาดไม่ต่าง)

> ดูการทำงานของแต่ละ endpoint: [WORKER-GUIDE.md](WORKER-GUIDE.md)
