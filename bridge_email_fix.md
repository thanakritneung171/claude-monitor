# แก้ไข: Bridge Account Email ไม่อัพเดทเมื่อ Switch Account

> ## ✅ IMPLEMENTED — บันทึกประวัติ
> การแก้นี้ทำไปแล้ว: `ClaudeBridgeMonitor` อ่าน `account.email_address` จาก `connect` handshake ของ bridge WebSocket แล้ว (ดู `proxy/addon.py`) เก็บไว้เป็นบันทึกที่มาของฟีเจอร์ ในระบบ identity ปัจจุบัน bridge เป็น 1 ใน 4 ช่องทาง resolve email — ดู [CONTEXT-PROMPT-LOG-SYSTEM.md](CONTEXT-PROMPT-LOG-SYSTEM.md) §3.4

## ปัญหา

เมื่อใช้ **Claude Code** (CLI / VSCode) ที่ login ด้วย Claude subscription account แล้ว switch account — ระบบยังแสดง email ของ account เดิมอยู่

### สาเหตุ

`ClaudeAccountSniffer` ดัก email จาก **claude.ai HTTP responses** เท่านั้น (เช่น `/api/bootstrap`, `/api/auth/current_account`) แต่ Claude Code ที่ใช้ subscription login จะไปทาง **`bridge.claudeusercontent.com` WebSocket** แทน — ซึ่ง `ClaudeBridgeMonitor` ดักแค่ request/response ของ API call แต่ไม่ได้ดึง account info จาก `connect` handshake

```
Claude Code (subscription)
    └─▶ bridge.claudeusercontent.com (WebSocket)
            ├─▶ connect { client_type, account: { email_address } }  ← ❌ ไม่ได้ดึง email
            └─▶ request / stream_event / done
```

---

## การแก้ไข

### ไฟล์ที่แก้: `addon.py`

### จุดที่ 1 — `ClaudeBridgeMonitor.websocket_message()` (บรรทัด ~847)

**ก่อนแก้:**
```python
# Update client identity when we see the connect handshake
if t == "connect" and msg.from_client:
    ct = data.get("client_type", "")
    if ct in self._CLIENT_MAP:
        sess["client"] = self._CLIENT_MAP[ct]
    return
```

**หลังแก้:**
```python
# Update client identity when we see the connect handshake
if t == "connect" and msg.from_client:
    ct = data.get("client_type", "")
    if ct in self._CLIENT_MAP:
        sess["client"] = self._CLIENT_MAP[ct]

    # ดึง email จาก connect payload
    # bridge ส่ง account info ใน connect message เช่น:
    # {"type":"connect","client_type":"claude-code",
    #  "account":{"email_address":"x@y.com","uuid":"..."},...}
    acct_blob = (
        data.get("account") or
        data.get("user") or
        data.get("auth") or
        {}
    )
    bridge_email = (
        acct_blob.get("email_address") or
        acct_blob.get("email") or
        data.get("email_address") or
        data.get("email") or
        ""
    )
    if _looks_like_email(bridge_email):
        ip = sess["src_ip"]
        old = _ACCOUNT_BY_IP.get(ip, {}).get("email", "")
        if bridge_email != old:
            _ACCOUNT_BY_IP[ip] = {
                "email": bridge_email,
                "name":  acct_blob.get("full_name") or acct_blob.get("name") or "",
                "uuid":  acct_blob.get("uuid") or "",
            }
            print(f"[claude-bridge] ✓ account switch detected: {old or '(none)'} → {bridge_email}")
    return
```

---

## Debug — ถ้า Email ยังไม่ถูกต้อง

เพิ่ม log ชั่วคราวเพื่อดู payload จริงจาก bridge:

```python
if t == "connect" and msg.from_client:
    print(f"[claude-bridge-DEBUG] connect payload: {json.dumps(data, ensure_ascii=False)[:500]}")
```

รัน แล้ว switch account → ดู terminal จะเห็น field จริงๆ ที่ bridge ส่งมา แล้วค่อยปรับ field name ให้ตรง

---

## Flow หลังแก้ไข

```
Claude Code switch account
    └─▶ bridge.claudeusercontent.com WebSocket
            └─▶ connect { account: { email_address: "new@email.com" } }
                    └─▶ ClaudeBridgeMonitor ดึง email ✅
                            └─▶ _ACCOUNT_BY_IP[ip] อัพเดทเป็น email ใหม่ ✅
                                    └─▶ log บันทึก email ถูกต้อง ✅
```

---

## สรุปการเปลี่ยนแปลง

| ส่วน | ก่อน | หลัง |
|---|---|---|
| `connect` handler | ดึงแค่ `client_type` | ดึง `client_type` + `email` |
| account switch | ไม่รู้จัก | อัพเดท `_ACCOUNT_BY_IP` ทันที |
| log | แสดง email เก่า | แสดง email ของ account ที่ใช้จริง |
