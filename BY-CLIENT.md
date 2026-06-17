# By Client — ประเภท Client ที่ระบบ Tag ได้

> **หมายเหตุ (2026-06):** ค่า `client` ทั้ง 7 และ logic การตรวจจับยัง**ถูกต้อง**ตามปัจจุบัน แต่ **เลขบรรทัดที่อ้างถึง `proxy/addon.py` ในเอกสารนี้ล้าสมัยแล้ว** (โค้ดถูกเพิ่ม/ย้ายหลายรอบ) — logic จริงอยู่ที่ `_detect_client()`, `_looks_like_cowork()`, `_looks_like_code()` ใน `proxy/addon.py` และ bridge mapping ใน `ClaudeBridgeMonitor` ดูสรุปล่าสุดที่ [README.md](README.md) (หัวข้อ "วิธีตรวจจับ Client") + [DEVELOPER.md](DEVELOPER.md)

เอกสารสรุปค่า `client` ที่ proxy (`mitmproxy` addon) ติด tag ลง log แต่ละ row พร้อม logic การตรวจจับและจุดในโค้ด

---

## สรุปค่า client ทั้งหมด (7 ค่า)

| # | Client | ที่มา | เงื่อนไขการตรวจ |
|---|---|---|---|
| 1 | `claude-code-cli` | [proxy/addon.py:176](proxy/addon.py#L176), [:797-798](proxy/addon.py#L797-L798) | header มี `claude-code` แต่ไม่ใช่ Electron / ไม่ใช่ VSCode<br>หรือ bridge `client_type` = `claude-code` / `cli` |
| 2 | `claude-code-vscode` | [proxy/addon.py:175](proxy/addon.py#L175), [:179](proxy/addon.py#L179), [:799](proxy/addon.py#L799) | `x-client-context: vscode` หรือ UA มี `vscode` / `visual-studio-code`<br>หรือ bridge `client_type=vscode` |
| 3 | `claude-desktop-code` | [proxy/addon.py:173](proxy/addon.py#L173) | Claude Code ที่ฝังใน **"Code" tab** ของ Claude Desktop<br>(electron + claude-code, แต่ไม่ใช่ vscode) |
| 4 | `claude-desktop` | [proxy/addon.py:182](proxy/addon.py#L182), [:599](proxy/addon.py#L599) | Electron app หรือ UA มี `anthropic` (Claude Desktop ปกติ) |
| 5 | `claude-desktop-cowork` | [proxy/addon.py:463](proxy/addon.py#L463) | request มีการเรียก tool ชื่อ `mcp__cowork__*`<br>(override client อื่นเสมอ) |
| 6 | `browser-extension` | [proxy/addon.py:800](proxy/addon.py#L800) | bridge `client_type=chrome-extension` |
| 7 | `api` | [proxy/addon.py:184](proxy/addon.py#L184) | fallback — ไม่ตรง pattern ไหนเลย (เช่น เรียก API ตรงๆ ด้วย SDK / curl) |

---

## Logic การตรวจ — `_detect_client()`

อ่านจาก HTTP headers 4 ตัว:

```
user-agent
anthropic-client-name
x-app
x-client-context
```

ดูที่ [proxy/addon.py:156-184](proxy/addon.py#L156-L184)

```python
def _detect_client(headers) -> str:
    ua   = headers.get("user-agent", "").lower()
    name = headers.get("anthropic-client-name", "").lower()
    app  = headers.get("x-app", "").lower()
    ctx  = headers.get("x-client-context", "").lower()

    is_claude_code = "claude-code" in (name + ua + app)
    is_electron    = "electron" in ua          # Claude Desktop = Electron
    is_vscode      = "vscode" in ctx or "vscode" in ua \
                     or "visual-studio-code" in ua or "vscode" in name

    if is_claude_code:
        if is_electron and not is_vscode:  return "claude-desktop-code"
        if is_vscode:                      return "claude-code-vscode"
        return "claude-code-cli"

    if is_vscode:                          return "claude-code-vscode"
    if is_electron or "anthropic" in ua:   return "claude-desktop"
    return "api"
```

หมายเหตุ:
- ไม่ match แค่ `claude/` ใน UA เพราะทั้ง CLI และ Desktop มี string นี้
- Claude Desktop ใช้ Electron ทุกตัว → check `electron/` ใน UA

---

## Bridge WebSocket — `_CLIENT_MAP`

session ที่ผ่าน `bridge.claudeusercontent.com` (เช่น VSCode account-login flow) จะส่ง `connect` handshake ที่บอก `client_type` มาตรงๆ

ดูที่ [proxy/addon.py:795-801](proxy/addon.py#L795-L801)

```python
_CLIENT_MAP = {
    "claude-code":      "claude-code-cli",
    "cli":              "claude-code-cli",
    "vscode":           "claude-code-vscode",
    "chrome-extension": "browser-extension",
}
```

---

## Special Case — Cowork

ที่ [proxy/addon.py:463](proxy/addon.py#L463): ถ้า request body มี tool name ขึ้นต้นด้วย `mcp__cowork__` → tag เป็น `claude-desktop-cowork` ทันที (override ค่าจาก header detection)

เหตุผล: Cowork tools รันบน Claude Desktop เท่านั้น และเป็นจุดเก็บข้อมูลสำคัญที่ต้องแยกจาก Desktop ปกติ

---

## การแสดงผลใน Dashboard — `normalizeClient()`

ที่ [worker/src/lib/badge.ts:60-63](worker/src/lib/badge.ts#L60-L63):

```typescript
export function normalizeClient(raw: string): string {
    if (raw === 'claude-code-cli' || raw === 'claude-desktop')
        return 'claude-code-cli, claude-desktop';
    return raw;
}
```

→ Badge บนหน้า dashboard จะ **รวม** `claude-code-cli` กับ `claude-desktop` เป็น label เดียว `claude-code-cli, claude-desktop` (แสดง 2 บรรทัด)

> **ค่าใน DB ยังเก็บแยกเหมือนเดิม** — รวมเฉพาะตอน render badge เพราะ flow บางตัวแยกสองตัวนี้ออกจากกันไม่ได้แน่ชัด

---

## Quick reference — แต่ละ client เกิดจากการใช้งานอะไร

| Client | สถานการณ์การใช้งานจริง |
|---|---|
| `claude-code-cli` | รัน `claude` CLI ใน terminal |
| `claude-code-vscode` | ใช้ Claude Code extension ใน VSCode |
| `claude-desktop-code` | เปิด Claude Desktop แล้วใช้แท็บ "Code" |
| `claude-desktop` | Chat ปกติใน Claude Desktop |
| `claude-desktop-cowork` | ใช้ Cowork tools (`mcp__cowork__*`) ใน Desktop |
| `browser-extension` | Claude Chrome extension |
| `api` | เรียก `api.anthropic.com` ตรงๆ ด้วย SDK / curl / โค้ดเอง |
