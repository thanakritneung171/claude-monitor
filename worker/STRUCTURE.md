# Worker Refactor Plan — แยกโครงสร้างไฟล์

แผนการแยก [src/index.ts](src/index.ts) (~946 บรรทัด) ออกเป็นไฟล์ย่อยตามความรับผิดชอบ

---

## โครงสร้างที่เสนอ

```
worker/src/
├── index.ts                  # entry: route dispatch เท่านั้น (~40 บรรทัด)
├── types.ts                  # ApiLog, Filters, Env
│
├── routes/
│   ├── log.ts                # POST /log   (รับข้อมูลยิงเข้ามา)
│   ├── dashboard.ts          # GET /       (query DB + render)
│   ├── export.ts             # GET /export (download CSV)
│   └── health.ts             # GET /health
│
├── db/
│   ├── queries.ts            # SQL ทั้งหมด (list, count, totals, byModel, byClient, …)
│   └── filters.ts            # buildWhere(), normalizeClient()
│
├── lib/
│   ├── format.ts             # esc, num, fmtBkk, fmtBkkParts
│   ├── date.ts               # todayBkk, firstOfMonthBkk, firstOfYearBkk, dateToMs
│   ├── badge.ts              # modelBadge, clientBadge, accountBadge, modelLabel
│   └── csv.ts                # toCsv
│
└── views/
    ├── dashboard.html        # โครง HTML + {{placeholder}}
    ├── dashboard.css         # CSS ทั้งหมด (~200 บรรทัด)
    ├── dashboard.client.js   # frontend JS: modal, period seg, trend chart, clock
    └── dashboard.ts          # render(): โหลด 3 ไฟล์ข้างบน + แทน placeholder
```

---

## หน้าที่ของแต่ละไฟล์

| ไฟล์ | รับผิดชอบ | ย้ายมาจากบรรทัดเดิม |
|---|---|---|
| `index.ts` | route dispatch เท่านั้น | [810-946](src/index.ts#L810-L946) |
| `types.ts` | `ApiLog`, `Filters`, `Env` | [3-35](src/index.ts#L3-L35) |
| `routes/log.ts` | INSERT log ลง D1 | [820-853](src/index.ts#L820-L853) |
| `routes/dashboard.ts` | parse filters → เรียก queries → เรียก view | [859-915](src/index.ts#L859-L915) |
| `routes/export.ts` | query + `toCsv` + response headers | [918-942](src/index.ts#L918-L942) |
| `routes/health.ts` | health check | [856](src/index.ts#L856) |
| `db/queries.ts` | SQL ทั้งหมด คืน object พร้อมใช้ | [881-900](src/index.ts#L881-L900) |
| `db/filters.ts` | `buildWhere()` | [140-159](src/index.ts#L140-L159) |
| `lib/format.ts` | `esc`, `num`, `fmtBkk*` | [45-74](src/index.ts#L45-L74) |
| `lib/date.ts` | helpers วันที่ Bangkok | [76-93](src/index.ts#L76-L93) |
| `lib/badge.ts` | สร้าง chip HTML | [95-124](src/index.ts#L95-L124) |
| `lib/csv.ts` | `toCsv()` | [126-138](src/index.ts#L126-L138) |
| `views/dashboard.html` | โครงร่าง HTML | [342-727](src/index.ts#L342-L727) |
| `views/dashboard.css` | CSS ล้วน | [351-554](src/index.ts#L351-L554) |
| `views/dashboard.client.js` | JS ฝั่ง browser | [729-804](src/index.ts#L729-L804) |
| `views/dashboard.ts` | สร้าง partials (rows, cards, bars, KPI) + แทน placeholder | [167-340](src/index.ts#L167-L340) |

---

## ตัวอย่าง `dashboard.html` พร้อม placeholder

```html
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>Claude Monitor</title>
  <style>{{css}}</style>
</head>
<body>
  ...
  <section class="stats">
    {{featuredCostCard}}
    {{statCards}}
  </section>
  ...
  <tbody>{{logRows}}</tbody>
  <div class="logs-cards">{{logCards}}</div>
  {{pagination}}
  ...
  <script>
    const D_TODAY='{{today}}', D_MONTH='{{firstMonth}}', D_YEAR='{{firstYear}}';
    const TREND_DATA={{trendData}};
    {{clientJs}}
  </script>
</body>
</html>
```

## ตัวอย่าง `views/dashboard.ts`

```ts
import html from './dashboard.html';
import css from './dashboard.css';
import clientJs from './dashboard.client.js';

export function render(data: DashboardData): string {
  return html
    .replace('{{css}}', css)
    .replace('{{clientJs}}', clientJs)
    .replace('{{statCards}}', renderStatCards(data.totals))
    .replace('{{logRows}}', renderLogRows(data.rows))
    .replace('{{logCards}}', renderLogCards(data.rows))
    .replace('{{pagination}}', renderPagination(data.filters, data.totalCount))
    // ...
}
```

## ตัวอย่าง `index.ts` หลัง refactor

```ts
import type { Env } from './types';
import { handleLog } from './routes/log';
import { handleDashboard } from './routes/dashboard';
import { handleExport } from './routes/export';
import { handleHealth } from './routes/health';
import { json } from './lib/format';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    }

    if (pathname === '/log'    && request.method === 'POST') return handleLog(request, env);
    if (pathname === '/health')                              return handleHealth();
    if (pathname === '/'       && request.method === 'GET')  return handleDashboard(url, env);
    if (pathname === '/export' && request.method === 'GET')  return handleExport(url, env);

    return json({ ok: false, error: 'Not Found' }, 404);
  },
} satisfies ExportedHandler<Env>;
```

---

## สิ่งที่ต้องตั้งค่าเพิ่ม

ต้องบอก esbuild ให้ import `.html` / `.css` / `.client.js` เป็น text — เพิ่มใน [wrangler.jsonc](wrangler.jsonc):

```jsonc
{
  "rules": [
    { "type": "Text", "globs": ["**/*.html", "**/*.css", "**/*.client.js"] }
  ]
}
```

และเพิ่ม module declaration ใน `src/types.d.ts` หรือไฟล์ `.d.ts` ใดๆ:

```ts
declare module '*.html' { const content: string; export default content; }
declare module '*.css'  { const content: string; export default content; }
declare module '*.client.js' { const content: string; export default content; }
```

---

## ข้อดี

- `index.ts` เหลือ ~40 บรรทัด เห็น route ทั้งหมดในที่เดียว
- แก้ CSS/HTML ได้โดยไม่ต้องเปิดไฟล์ logic — editor ให้ syntax highlight เต็มที่
- เพิ่ม route ใหม่ = เพิ่มไฟล์ใน `routes/` ไฟล์เดียว
- test แต่ละ helper แยกได้ง่าย
- ส่วน backend (`POST /log`) แยกชัด ไม่ปนกับโค้ด render

## ข้อควรพิจารณา

- เพิ่มจาก 1 ไฟล์ → ~15 ไฟล์ (ถ้าโปรเจกต์เล็กกว่านี้อาจ overkill)
- ใช้ `.replace()` placeholder ธรรมดา — ถ้าต้องการ type-safety ต้องใช้ template literal ใน `.ts` แทน
- Worker ยังเป็น bundle เดียวเหมือนเดิม (deploy ขนาดไม่ต่างกัน)

---

## ลำดับการ refactor ที่แนะนำ

1. **สร้าง `types.ts`** — ย้าย interfaces ก่อน (ไม่กระทบ runtime)
2. **สร้าง `lib/`** — ย้าย pure helpers (format, date, badge, csv)
3. **สร้าง `db/`** — ย้าย `buildWhere` + SQL queries
4. **สร้าง `views/`** — แยก HTML/CSS/JS ออกจาก `buildDashboard()`
5. **สร้าง `routes/`** — ย้าย handler แต่ละ endpoint
6. **เหลือ `index.ts`** ที่เป็น dispatcher อย่างเดียว
7. ทดสอบทีละ step — รัน `wrangler dev` หลังย้ายแต่ละกลุ่ม
