# IDENTITY NAME FILL — แผนเติมชื่อใน IP Identity

> ## ⚠️ SUPERSEDED (2026-06) — บันทึกประวัติ
> แผนนี้เกี่ยวกับการเติม `name` ในตาราง **`ip_identity`** (IP-based) ซึ่งปัจจุบัน **เลิกใช้แล้ว** (`ip_identity` ถูก DROP ใน migration `0011`, หน้า `/identity` กลายเป็น snapshot **frozen**) ทะเบียนตัวตนปัจจุบันคือ **`email_identity`** (keyed ด้วย email) ที่มีคอลัมน์ `name` และเติมผ่าน `upsertEmailIdentity()` แล้ว — ปัญหาในเอกสารนี้จึงไม่เกี่ยวข้องอีก เก็บไว้เป็นบันทึกประวัติ ดู [CONTEXT-PROMPT-LOG-SYSTEM.md](CONTEXT-PROMPT-LOG-SYSTEM.md) §4
>
> ---
>
> **(เดิม) สถานะ:** ยังไม่ทำ — เก็บไว้ปรับภายหลัง
> **ปัญหา:** หน้า `/identity` คอลัมน์ **NAME** ว่าง (`—`) ทุกแถว ทั้งที่ proxy จับชื่อมาได้แล้ว
> **สาเหตุย่อ:** ตาราง `ip_identity` มีคอลัมน์ `name` พร้อม และ proxy เก็บ `full_name` ไว้ใน `_ACCOUNT_BY_IP[ip]["name"]` แล้ว — แต่ "การส่ง name ผ่าน payload → worker → upsert" ยังไม่ได้ต่อ

---

## 1. Root cause — ท่อขาด 3 จุด

```
proxy จับ name ได้         worker รับ payload          upsert ลง DB             UI แสดง
_ACCOUNT_BY_IP[ip]["name"]  ──X──>  ApiLog (ไม่มี field)  ──X──>  upsertIdentity(...,'')  ──>  '—'
        ✅ มีค่า                  ❌ ไม่ส่ง                    ❌ ไม่ส่ง name             (fallback ว่าง)
```

| # | จุด | ไฟล์ | อาการ |
|---|-----|------|-------|
| 1 | Proxy ไม่ส่ง name ใน payload | [proxy/addon.py](proxy/addon.py) | เก็บ `name` ไว้ที่ `_ACCOUNT_BY_IP[ip]["name"]` (บรรทัด 755, 764, 810, 919) แต่ payload (542-559, 636-..., 1019-...) ส่งแค่ `account_email` |
| 2 | Worker ไม่มี field รองรับ | [worker/src/types.ts:13-30](worker/src/types.ts#L13-L30) | `ApiLog` ไม่มี `account_name` |
| 3 | ตอน sync mapping ไม่ส่ง name | [worker/src/routes/log.ts:29](worker/src/routes/log.ts#L29) | `upsertIdentity(env, ip, b.account_email)` ไม่ส่ง arg ที่ 4 → default `''` → SQL update name เฉพาะ `excluded.name != ''` ([queries.ts:346](worker/src/db/queries.ts#L346)) → ว่างตลอด |

ปลายทาง UI: [identity.ts:37](worker/src/views/identity.ts#L37) `r.name ? esc(r.name) : '—'` — แสดง `—` เป็น placeholder ปกติเวลา name ว่าง

---

## 2. วิธีแก้ — แก้ 3 ไฟล์ (ไม่ต้อง migrate DB)

> คอลัมน์ `ip_identity.name` มีอยู่แล้วใน [migration 0005](worker/migrations/0005_ip_identity.sql) → **ไม่ต้องสร้าง migration ใหม่**

### 2.1 Proxy — เพิ่ม helper + เติม `account_name` ใน payload ทั้ง 3 จุด

เพิ่ม helper ใกล้ๆ `current_email()` ([addon.py:68-69](proxy/addon.py#L68-L69)):

```python
def current_name(flow) -> str:
    return _ACCOUNT_BY_IP.get(_client_ip(flow), {}).get("name", "")
```

จากนั้นเติม `"account_name"` ในแต่ละ payload ใต้บรรทัด `"account_email"`:

- **API** (~[addon.py:546](proxy/addon.py#L546)) — มี `flow`:
  ```python
  "account_email":  email,
  "account_name":   current_name(flow),
  ```
- **claude.ai desktop** (~[addon.py:640](proxy/addon.py#L640)) — มี `flow`:
  ```python
  "account_email":  email,
  "account_name":   current_name(flow),
  ```
- **bridge / cowork** (~[addon.py:1023](proxy/addon.py#L1023)) — ใช้ `sess["src_ip"]` ไม่ใช่ flow:
  ```python
  "account_email":  email,
  "account_name":   _ACCOUNT_BY_IP.get(sess["src_ip"], {}).get("name", ""),
  ```

### 2.2 Worker types — เพิ่ม field แบบ optional

[worker/src/types.ts](worker/src/types.ts) ใน `interface ApiLog` (ใต้ `account_email`):

```ts
account_email: string;
account_name?: string;   // optional — proxy เก่า/payload ที่ไม่มีก็ไม่พัง
```

> ใช้ `?` (optional) เพื่อไม่ให้เกิด TS compile error ที่อื่น และ proxy เก่ายังส่ง payload เดิมได้

### 2.3 Worker log route — ส่ง name ต่อให้ upsert

[worker/src/routes/log.ts:28-30](worker/src/routes/log.ts#L28-L30):

```ts
// L3 sync: log has a real email → upsert mapping for next empty log
if (b.account_email && ip) {
    await upsertIdentity(env, ip, b.account_email, b.account_name ?? '');
}
```

> `?? ''` กัน undefined จาก proxy เก่า — ตรงกับ default ของ `upsertIdentity(..., name = '')`

---

## 3. ผลกระทบ (ประเมินแล้ว — ความเสี่ยงต่ำ)

### ✅ ปลอดภัย / ไม่ต้องแตะ
- **`insertLog`** ([queries.ts:303-328](worker/src/db/queries.ts#L303-L328)) bind คอลัมน์แบบ fix list ไม่มี `account_name` → `account_name` แค่ไหลผ่าน `b` ไปเข้า upsert ไม่ลง `api_logs` → **ไม่ต้อง migrate `api_logs`**
- **CSV export / dashboard / account views** อ่านจาก `api_logs` ซึ่งไม่เปลี่ยน → เหมือนเดิม
- **Proxy เก่าที่ยังไม่อัปเดต** → `b.account_name` undefined → `?? ''` → ทำงานเหมือนเดิมเป๊ะ (backward-compatible)
- **Deploy** worker/proxy สลับลำดับกันได้ ไม่ต้อง deploy พร้อมกัน

### ⚠️ พฤติกรรมที่ต้องเข้าใจ (ไม่ใช่ bug)
1. **Backfill ค่อยเป็นค่อยไป** — แถวเดิมยังเป็น `—` จนกว่าแต่ละ IP จะยิง log ใหม่ที่พก name มา (upsert update name ตอน `excluded.name != ''`) ไม่ย้อนเติมของเก่า
2. **บาง IP อาจ `—` ตลอด** — name เติมได้เฉพาะ IP ที่ proxy เคยเห็น auth response ของ claude.ai (AccountSniffer) ถ้าเป็น API-key ล้วนจะยังว่าง
3. **JSONL local** มี field `account_name` เพิ่มต่อบรรทัด (field เกินปกติถูก ignore โดย consumer ทั่วไป)
4. **PII** เริ่มเก็บชื่อจริงลง D1 (เพิ่มไม่มาก เพราะ email `firstname.lastname@` ก็บอกตัวตนอยู่แล้ว)

---

## 4. วิธีทดสอบหลังแก้
1. รัน proxy ใหม่ → ให้ผู้ใช้ที่ login claude.ai ยิง call 1 ครั้ง
2. เช็ค JSONL บรรทัดล่าสุดมี `"account_name": "..."` ไหม
3. เปิด `/identity` → แถวของ IP นั้นควรขึ้นชื่อแทน `—`
4. ทดสอบ backward-compat: ส่ง payload ที่ **ไม่มี** `account_name` → ต้องไม่ error และ name ของแถวนั้นไม่ถูกล้าง (เพราะ `?? ''` + SQL `excluded.name != ''`)

---

## 5. ไฟล์ที่เกี่ยวข้อง (อ้างอิงเร็ว)
- Proxy payload + sniffer: [proxy/addon.py](proxy/addon.py) — helper `current_email` (68-69), payloads (542, 636, 1019), sniffer เก็บ name (755/764/810/919)
- Worker type: [worker/src/types.ts](worker/src/types.ts)
- Worker log route: [worker/src/routes/log.ts](worker/src/routes/log.ts)
- DB upsert + query: [worker/src/db/queries.ts](worker/src/db/queries.ts) — `upsertIdentity` (339), `fetchIdentityList` (361)
- UI: [worker/src/views/identity.ts](worker/src/views/identity.ts) — `row()` (33), placeholder `—` (37)
- Migration (มีคอลัมน์ name แล้ว): [worker/migrations/0005_ip_identity.sql](worker/migrations/0005_ip_identity.sql)
