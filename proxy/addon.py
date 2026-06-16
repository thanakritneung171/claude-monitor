"""
Claude Monitor — mitmproxy addon
Intercepts Claude API calls and logs to Cloudflare Worker + local JSONL.

Targets:
  - api.anthropic.com/v1/messages           (API key / Claude Code with ANTHROPIC_BASE_URL)
  - claude.ai  /api/organizations/.../chat_conversations/.../completion  (Claude Desktop app)

Usage:
    mitmdump -s addon.py --listen-port 8080 --allow-hosts "claude.ai"
"""

import hashlib
import json
import re
import socket
import threading
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

from mitmproxy import http

# ── Load config ───────────────────────────────────────────────────────────────
try:
    import config
    WORKER_URL = config.WORKER_URL.rstrip("/")
    API_KEY    = config.API_KEY
except ImportError:
    raise SystemExit("config.py not found — copy config.example.py → config.py and fill in values.")

# ── Email filter ─────────────────────────────────────────────────────────────
# When enabled, only log calls whose detected account_email contains
# EMAIL_FILTER_SUBSTRING (case-insensitive). Calls with no detected email
# (e.g. raw API key users) are dropped while the filter is on.
# Configured in config.py (which itself reads env vars, for Docker). getattr
# keeps backward-compat if an older config.py lacks these fields.
EMAIL_FILTER_ENABLED   = getattr(config, "EMAIL_FILTER_ENABLED", True)
EMAIL_FILTER_SUBSTRING = getattr(config, "EMAIL_FILTER_SUBSTRING", "@softdebut")

def _should_log(email: str) -> bool:
    if not EMAIL_FILTER_ENABLED:
        return True
    if not EMAIL_FILTER_SUBSTRING:
        return True
    return EMAIL_FILTER_SUBSTRING.lower() in (email or "").lower()

if EMAIL_FILTER_ENABLED:
    print(f"[claude-monitor] email filter ON — only logging accounts containing "
          f"'{EMAIL_FILTER_SUBSTRING}'")
else:
    print("[claude-monitor] email filter OFF — logging all accounts")

# ── Identity caches — keyed by EMAIL (IP is NEVER used as identity) ──────────
# Each prompt request carries its own identity token, so we resolve identity
# from the request itself and key the attribute caches by email (VPN-safe):
#   • api.anthropic.com/v1/messages → Bearer JWT (email claim)        [_jwt_email]
#   • claude.ai/.../completion       → session cookie → email map     [_session_key]
_ACCOUNT_BY_EMAIL: dict[str, dict] = {}   # email -> {name, uuid, account_id, org_id}
_DEVICE_BY_EMAIL:  dict[str, dict] = {}   # email -> {app_version, os_type, os_version, host_arch, terminal, device_id, mac_address}
_EMAIL_BY_SESSION: dict[str, str]  = {}   # sha256(sessionKey cookie) -> email   (claude.ai chat)
_EMAIL_BY_TOKEN:   dict[str, str]  = {}   # sha256(OAuth Bearer token)  -> email   (clients that send a JWT)
_EMAIL_BY_UUID:    dict[str, str]  = {}   # account_uuid -> email   (Claude Code — PRIMARY link, even with raw sk- keys)

def _device_info(email: str) -> dict:
    """Return device/env + account fields for an account email (all default '')."""
    d = _DEVICE_BY_EMAIL.get(email, {})
    a = _ACCOUNT_BY_EMAIL.get(email, {})
    return {
        "app_version": d.get("app_version", ""),
        "os_type":     d.get("os_type",     ""),
        "os_version":  d.get("os_version",  ""),
        "host_arch":   d.get("host_arch",   ""),
        "terminal":    d.get("terminal",    ""),
        "device_id":   d.get("device_id",   ""),
        "mac_address": d.get("mac_address", ""),
        "account_id":  a.get("account_id",  ""),
        "org_id":      a.get("org_id",      ""),
    }

def _client_ip(flow) -> str:
    """Client source IP — recorded on logs as AUDIT only, never used as identity."""
    try:
        peer = flow.client_conn.peername
        return peer[0] if peer else ""
    except Exception:
        return ""


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload (middle part) without verifying signature."""
    try:
        import base64 as _b64
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        seg = parts[1]
        seg += "=" * (4 - len(seg) % 4)
        return json.loads(_b64.urlsafe_b64decode(seg))
    except Exception:
        return {}


def _jwt_email(flow) -> str:
    """Email from the request's own Bearer JWT (CLI/VSCode/Desktop-Code/Cowork).
    Returns '' when there is no JWT (raw API key, or non-/v1/messages clients)."""
    auth = flow.request.headers.get("Authorization", "") or \
           flow.request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return ""
    token = auth[7:]
    if token.startswith("sk-"):     # raw API key — not a JWT
        return ""
    payload = _decode_jwt_payload(token)
    email = payload.get("email") or payload.get("email_address") or ""
    return email if _looks_like_email(email) else ""


def _session_key(flow) -> str:
    """Stable per-login key for claude.ai chat: sha256 of the sessionKey cookie.
    Hashed so we never hold the raw session token in memory. '' when no cookie."""
    raw = flow.request.headers.get("Cookie", "") or \
          flow.request.headers.get("cookie", "")
    if not raw:
        return ""
    token = ""
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k in ("sessionKey", "__Secure-sessionKey"):
            token = v.strip()
            break
    if not token:
        return ""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _bearer_key(flow) -> str:
    """Stable per-login key for Claude Code: sha256 of the OAuth Bearer token.
    The SAME token rides every request from a logged-in Claude Code session —
    /v1/messages, count_tokens AND /api/claude_code/metrics. The metrics body
    carries user.email but the /v1/messages JWT does not, so we link the two by
    this token instead of by client IP (VPN-safe). '' for raw sk- API keys."""
    auth = flow.request.headers.get("Authorization", "") or \
           flow.request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return ""
    token = auth[7:].strip()
    if not token or token.startswith("sk-"):
        return ""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _meta_account_uuid(flow) -> str:
    """account_uuid from a /v1/messages request body's metadata.user_id.

    Claude Code authenticates with a raw API key (no JWT), but every request
    body carries:  metadata.user_id = '{"device_id":"…","account_uuid":"…",
    "session_id":"…"}'  — a JSON string. The account_uuid is the stable
    per-account id (VPN-safe) and matches user.account_uuid on the metrics
    endpoint, so it links a prompt to the email metrics revealed."""
    try:
        body = json.loads(flow.request.content)
    except Exception:
        return ""
    meta = body.get("metadata") if isinstance(body, dict) else None
    uid  = meta.get("user_id") if isinstance(meta, dict) else None
    if not uid:
        return ""
    if isinstance(uid, str):
        try:
            uid = json.loads(uid)
        except Exception:
            return ""
    return str(uid.get("account_uuid") or "") if isinstance(uid, dict) else ""


def current_email(flow) -> str:
    """Resolve the account email for the prompt being logged — NO IP.
      1) JWT on the request itself     (clients whose token carries an email claim)
      2) account_uuid in metadata      (Claude Code — works with raw sk- API keys)
      3) OAuth token → email map       (clients that send a JWT, email from metrics)
      4) session cookie → email map    (claude.ai chat, filled by ClaudeAccountSniffer)"""
    email = _jwt_email(flow)
    if email:
        return email
    uuid_ = _meta_account_uuid(flow)
    if uuid_ and _EMAIL_BY_UUID.get(uuid_):
        return _EMAIL_BY_UUID[uuid_]
    tok = _bearer_key(flow)
    if tok and _EMAIL_BY_TOKEN.get(tok):
        return _EMAIL_BY_TOKEN[tok]
    sess = _session_key(flow)
    return _EMAIL_BY_SESSION.get(sess, "") if sess else ""


def _set_account_email(email: str, name: str = "", uuid_: str = "",
                       account_id: str = "", org_id: str = "", source: str = "") -> None:
    """Merge account attributes into the email-keyed cache (non-destructive fill)."""
    if not _looks_like_email(email):
        return
    old = _ACCOUNT_BY_EMAIL.get(email)
    slot = old or {}
    if email not in _ACCOUNT_BY_EMAIL:
        print(f"[claude-account] ✓ {email} via {source}")
    new = {
        "name":       name       or slot.get("name",       ""),
        "uuid":       uuid_      or slot.get("uuid",       ""),
        "account_id": account_id or slot.get("account_id", ""),
        "org_id":     org_id     or slot.get("org_id",     ""),
    }
    _ACCOUNT_BY_EMAIL[email] = new
    changed = new != old
    # account_uuid → email: the PRIMARY link for Claude Code prompts (which carry
    # account_uuid in metadata.user_id but no email). Fed by every source that
    # knows both — metrics, bridge connect, claude.ai sniffer.
    if uuid_ and _EMAIL_BY_UUID.get(uuid_) != email:
        _EMAIL_BY_UUID[uuid_] = email
        changed = True
    # Persist on change so identity (incl. account_id/uuid/org) survives restarts.
    if changed:
        _persist_identity()


def _set_session_email(sess: str, email: str, name: str = "", uuid_: str = "") -> None:
    """Map a claude.ai session cookie → email (for the chat completion path)."""
    if not sess or not _looks_like_email(email):
        return
    if _EMAIL_BY_SESSION.get(sess) != email:
        _EMAIL_BY_SESSION[sess] = email
        print(f"[claude-account] ✓ session → {email}")
    _set_account_email(email, name=name, uuid_=uuid_, source="claude.ai")


# ── Persistent identity cache ────────────────────────────────────────────────
# account_uuid/email + account & device attributes are not secrets (unlike
# session tokens), so we persist the learned identity across restarts. This
# removes the cold-start window where, right after a restart, a resolved email
# would log with blank account_id/uuid/os/version until that user's metrics
# re-fires. Stored as one JSON file with three sections.
IDENTITY_FILE = Path(__file__).resolve().parent / "identity_cache.json"
UUID_MAP_FILE = Path(__file__).resolve().parent / "uuid_email_map.json"  # legacy (load-only)

def _persist_identity() -> None:
    try:
        IDENTITY_FILE.write_text(json.dumps({
            "uuid_email": _EMAIL_BY_UUID,
            "account":    _ACCOUNT_BY_EMAIL,
            "device":     _DEVICE_BY_EMAIL,
        }, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

def _load_identity_seed() -> None:
    """Restore the identity caches from disk at startup so resolved prompts get
    full account/device info immediately (no wait for metrics). To map an
    account that never emits metrics, add its "account_uuid": "email" under the
    "uuid_email" section of IDENTITY_FILE — loaded here, preserved on saves."""
    try:
        if IDENTITY_FILE.exists():
            data = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                for u, e in (data.get("uuid_email") or {}).items():
                    if u and _looks_like_email(e):
                        _EMAIL_BY_UUID[u] = e
                for em, a in (data.get("account") or {}).items():
                    if _looks_like_email(em) and isinstance(a, dict):
                        _ACCOUNT_BY_EMAIL[em] = a
                for em, d in (data.get("device") or {}).items():
                    if _looks_like_email(em) and isinstance(d, dict):
                        _DEVICE_BY_EMAIL[em] = d
    except Exception as exc:
        print(f"[claude-monitor] WARN could not load identity cache: {exc}")
    # Back-compat: merge the legacy flat uuid→email file if it still exists.
    try:
        if UUID_MAP_FILE.exists():
            data = json.loads(UUID_MAP_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                for u, e in data.items():
                    if u and _looks_like_email(e) and u not in _EMAIL_BY_UUID:
                        _EMAIL_BY_UUID[u] = e
    except Exception:
        pass
    print(f"[claude-monitor] identity seed: {len(_EMAIL_BY_UUID)} uuid→email, "
          f"{len(_ACCOUNT_BY_EMAIL)} accounts, {len(_DEVICE_BY_EMAIL)} devices loaded")


HOSTNAME = socket.gethostname()

# ── Local log directory (../log relative to this file) ───────────────────────
# resolve() makes the path absolute first — without it, Path(".").parent == Path(".")
# and the log dir would land at ./log relative to cwd instead of project/log
LOG_DIR  = Path(__file__).resolve().parent.parent / "log"
LOG_DIR.mkdir(exist_ok=True)

def _log_path() -> Path:
    """Returns log file path for today: log/claude_YYYY-MM-DD.jsonl"""
    today = datetime.now().strftime("%Y-%m-%d")
    return LOG_DIR / f"claude_{today}.jsonl"

def _write_local(payload: dict):
    """Append one JSON line to today's log file (thread-safe)."""
    try:
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        with open(_log_path(), "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass

# ── Pricing (USD / 1M tokens) ─────────────────────────────────────────────────
_PRICE = {
    "opus":   dict(inp=15,   out=75,   cr=1.50,  cw=18.75),
    "sonnet": dict(inp=3,    out=15,   cr=0.30,  cw=3.75),
    "haiku":  dict(inp=0.80, out=4,    cr=0.08,  cw=1.00),
}

def _calc_cost(model: str, inp: int, out: int, cr: int, cw: int) -> float:
    tier = "opus" if "opus" in model else "haiku" if "haiku" in model else "sonnet"
    p = _PRICE[tier]
    return (inp * p["inp"] + out * p["out"] + cr * p["cr"] + cw * p["cw"]) / 1_000_000


# ── Cowork heuristic: tools/metadata reveal it even when UA is generic ───────
def _looks_like_cowork(req: dict, headers) -> bool:
    """
    True if request body has cowork-specific MCP tools (mcp__cowork__*)
    or the metadata block names a cowork surface.
    """
    try:
        for tool in req.get("tools") or []:
            name = (tool.get("name") if isinstance(tool, dict) else "") or ""
            if name.startswith("mcp__cowork"):
                return True
        meta = req.get("metadata") or {}
        if isinstance(meta, dict):
            for v in meta.values():
                if isinstance(v, str) and "cowork" in v.lower():
                    return True
    except Exception:
        pass
    return False


# ── Code heuristic: Claude Code's classic native tools, no cowork markers ────
# Claude Desktop's "Code" tab and standalone Claude Code CLI both expose the
# same tool palette. The subprocess that issues the API call may strip the
# Electron UA, leaving headers ambiguous — body-side detection is more reliable.
_CODE_TOOLS = {
    "Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
    "Glob", "Grep", "Task", "TodoWrite", "WebFetch", "WebSearch",
    "ExitPlanMode", "BashOutput", "KillBash",
}

def _looks_like_code(req: dict) -> bool:
    try:
        tools = req.get("tools") or []
        if not isinstance(tools, list):
            return False
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            name = tool.get("name") or ""
            if name.lower().startswith("mcp__cowork"):
                return False  # cowork present — not pure Code
            if name in _CODE_TOOLS:
                return True
    except Exception:
        pass
    return False


# ── Client detection ──────────────────────────────────────────────────────────
def _detect_client(headers) -> str:
    ua   = str(headers.get("user-agent",            "")).lower()
    name = str(headers.get("anthropic-client-name", "")).lower()
    app  = str(headers.get("x-app",                 "")).lower()
    ctx  = str(headers.get("x-client-context",      "")).lower()

    is_claude_code = ("claude-code" in name or "claude-code" in ua or "claude-code" in app)
    # Claude Desktop ships as an Electron app — UA always carries "electron/".
    # Don't match plain "claude/" since the CLI's UA also contains it.
    is_electron    = "electron" in ua
    is_vscode      = ("vscode" in ctx) or ("vscode" in ua) or ("visual-studio-code" in ua) \
                     or ("vscode" in name)

    if is_claude_code:
        # Claude Code can run standalone (CLI), as a VSCode extension, or
        # embedded inside Claude Desktop's "Code" tab.
        if is_electron and not is_vscode:
            return "claude-desktop-code"
        if is_vscode:
            return "claude-code-vscode"
        return "claude-code-cli"

    if is_vscode:
        return "claude-code-vscode"

    if is_electron or "anthropic" in ua:
        return "claude-desktop"

    return "api"


# ── SSE stream parser for api.anthropic.com ───────────────────────────────────
def _parse_sse_api(text: str) -> dict:
    """Parse SSE from api.anthropic.com/v1/messages"""
    resp_text = ""
    inp = out = cr = cw = 0
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        if not raw or raw == "[DONE]":
            continue
        try:
            obj = json.loads(raw)
            t   = obj.get("type", "")
            if t == "message_start":
                u   = obj.get("message", {}).get("usage", {})
                inp = u.get("input_tokens", 0)
                cr  = u.get("cache_read_input_tokens", 0)
                cw  = u.get("cache_creation_input_tokens", 0)
            elif t == "content_block_delta":
                d = obj.get("delta", {})
                if d.get("type") == "text_delta":
                    resp_text += d.get("text", "")
            elif t == "message_delta":
                out = obj.get("usage", {}).get("output_tokens", 0)
        except Exception:
            pass
    return dict(response=resp_text, input_tokens=inp, output_tokens=out,
                cache_read_tokens=cr, cache_creation_tokens=cw)


# ── SSE stream parser for claude.ai Desktop ───────────────────────────────────
def _parse_sse_desktop(text: str) -> dict:
    """
    Parse SSE from claude.ai /api/organizations/.../chat_conversations/.../completion
    Claude.ai uses a mix of event types. Try multiple formats.
    """
    resp_text = ""
    inp = out = cr = cw = 0
    model = ""

    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        if not raw or raw == "[DONE]":
            continue
        try:
            obj = json.loads(raw)
            t   = obj.get("type", "")

            # New Anthropic SSE format (same as API)
            if t == "message_start":
                u   = obj.get("message", {}).get("usage", {})
                inp = u.get("input_tokens", 0)
                cr  = u.get("cache_read_input_tokens", 0)
                cw  = u.get("cache_creation_input_tokens", 0)
                model = obj.get("message", {}).get("model", model)
            elif t == "content_block_delta":
                d = obj.get("delta", {})
                if d.get("type") == "text_delta":
                    resp_text += d.get("text", "")
            elif t == "message_delta":
                out = obj.get("usage", {}).get("output_tokens", 0)

            # Old claude.ai format
            elif t == "completion":
                resp_text += obj.get("completion", "")
                inp = obj.get("usage", {}).get("input_tokens", inp)
                out = obj.get("usage", {}).get("output_tokens", out)

            # claude.ai may send full message object
            elif "delta" in obj and "type" not in obj:
                delta = obj.get("delta", {})
                if isinstance(delta, dict):
                    resp_text += delta.get("text", "")

        except Exception:
            pass

    return dict(response=resp_text, input_tokens=inp, output_tokens=out,
                cache_read_tokens=cr, cache_creation_tokens=cw, model=model)


# ── Extract last user prompt from api.anthropic.com messages ─────────────────
def _extract_prompt_api(messages: list) -> str:
    """
    Returns the user's actual typed prompt. Cowork injects <system-reminder>
    blocks (tool listings, context) ahead of the real input — those are
    skipped in favor of the last non-reminder text block.
    """
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        content = m.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [b.get("text", "") for b in content
                     if isinstance(b, dict) and b.get("type") == "text" and b.get("text")]
            if not texts:
                continue
            user_texts = [t for t in texts if not t.lstrip().startswith("<system-reminder>")]
            if user_texts:
                return user_texts[-1]
            return texts[-1]
    return ""


# ── Extract prompt from claude.ai Desktop request body ───────────────────────
def _extract_prompt_desktop(req_body: dict) -> str:
    """
    Claude.ai desktop sends conversation in various formats.
    Try to extract the latest human message.
    """
    # Format 1: prompt string (old format)
    if "prompt" in req_body:
        prompt = req_body["prompt"]
        # Extract last Human: turn
        if "\n\nHuman:" in prompt:
            parts = prompt.split("\n\nHuman:")
            last = parts[-1]
            if "\n\nAssistant:" in last:
                last = last.split("\n\nAssistant:")[0]
            return last.strip()
        return prompt.strip()

    # Format 2: messages array (new format)
    if "messages" in req_body:
        return _extract_prompt_api(req_body["messages"])

    # Format 3: text field
    if "text" in req_body:
        return req_body["text"]

    return ""


# ── Fire-and-forget HTTP POST to Worker ──────────────────────────────────────
# Build ONE opener that bypasses system proxy (avoid loopback through mitmproxy)
_no_proxy_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def _send_log(payload: dict):
    """Send log to Cloudflare Worker — bypasses system proxy to avoid loopback."""
    try:
        body = json.dumps(payload).encode()
        req  = urllib.request.Request(f"{WORKER_URL}/log", data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Api-Key",    API_KEY)
        # Cloudflare blocks default Python-urllib UA — use a real-looking UA
        req.add_header(
            "User-Agent",
            "Mozilla/5.0 (claude-monitor mitmproxy addon)"
        )
        resp = _no_proxy_opener.open(req, timeout=8)
        status = resp.getcode()
        if status != 200:
            print(f"[claude-monitor] WARN worker returned {status}")
    except Exception as e:
        # Print error so we can see what's failing
        print(f"[claude-monitor] ERROR sending to worker: {type(e).__name__}: {e}")


# ── Completion path pattern for claude.ai ─────────────────────────────────────
_COMPLETION_RE = re.compile(
    r"^/api/organizations/[^/]+/chat_conversations/[^/]+/completion$"
)


# ── Tool schema fixer ────────────────────────────────────────────────────────
# Anthropic's /v1/messages rejects tool input_schema that has oneOf/allOf/anyOf
# at the top level. Some claude.ai connectors (Notion, Google Drive, etc.) ship
# such schemas, so the request 400s before reaching the model. This hook
# detects offending tools in the outbound body and flattens the schema to a
# permissive object so the request goes through. Tools rewritten this way may
# accept inputs the original schema would have rejected, but the chat works.
_BAD_KEYS = ("oneOf", "allOf", "anyOf")
_FIX_LOG  = LOG_DIR / "schema_fixes.jsonl"


def _has_top_level_union(schema) -> bool:
    return isinstance(schema, dict) and any(k in schema for k in _BAD_KEYS)


def _flatten_schema(schema: dict) -> dict:
    """Replace top-level union with a permissive object, preserve description."""
    new = {"type": "object", "additionalProperties": True}
    if isinstance(schema.get("description"), str):
        new["description"] = schema["description"]
    return new


class ToolSchemaFixer:
    """Rewrites tool schemas in /v1/messages requests to satisfy Anthropic's API."""

    def request(self, flow: http.HTTPFlow):
        if flow.request.host   != "api.anthropic.com": return
        path = flow.request.path.split("?", 1)[0]
        if path != "/v1/messages":                      return
        if flow.request.method != "POST":               return

        try:
            body = json.loads(flow.request.content)
        except Exception:
            return

        tools = body.get("tools")
        if not isinstance(tools, list):
            return

        fixed_names = []
        for idx, tool in enumerate(tools):
            if not isinstance(tool, dict):
                continue

            # Anthropic's tool shape can be either {name, input_schema, ...}
            # or {type:"custom", name, custom:{input_schema, ...}}.
            # The 400 error path "tools.N.custom.input_schema" indicates the
            # second shape, but we handle both.
            if isinstance(tool.get("custom"), dict):
                holder = tool["custom"]
            else:
                holder = tool

            schema = holder.get("input_schema")
            if not _has_top_level_union(schema):
                continue

            holder["input_schema"] = _flatten_schema(schema)
            fixed_names.append((idx, tool.get("name") or holder.get("name") or "?"))

        if fixed_names:
            flow.request.content = json.dumps(body).encode("utf-8")
            try:
                with open(_FIX_LOG, "a", encoding="utf-8") as f:
                    f.write(json.dumps({
                        "ts":    int(datetime.now().timestamp() * 1000),
                        "fixed": [{"idx": i, "name": n} for i, n in fixed_names],
                    }, ensure_ascii=False) + "\n")
            except Exception:
                pass
            print(f"[claude-monitor] fixed bad schema on tools: "
                  f"{', '.join(f'{i}={n}' for i, n in fixed_names)}")


# ── mitmproxy addon: api.anthropic.com ───────────────────────────────────────
class ClaudeAPIMonitor:
    """Intercepts api.anthropic.com/v1/messages (API key users)."""

    def request(self, flow: http.HTTPFlow):
        """Pull email from Bearer JWT before forwarding.

        Claude Code (CLI / VSCode) with subscription login sends the OAuth
        access token (a JWT carrying an `email` claim) on every /v1/messages
        request. Decoding it here captures identity even when the user never
        opens claude.ai / Desktop — covers the case where the bridge WS path
        is skipped and traffic goes straight to api.anthropic.com.
        """
        if flow.request.host != "api.anthropic.com":
            return
        path = flow.request.path.split("?", 1)[0]
        if path != "/v1/messages":
            return

        auth = flow.request.headers.get("Authorization", "") or \
               flow.request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            return
        token = auth[7:]
        # Raw API key (`sk-ant-…`) is not a JWT — skip.
        if token.startswith("sk-"):
            return

        payload = _decode_jwt_payload(token)
        # One-time debug: reveal which claims the prompt token actually carries.
        # Confirms whether 'email' is present (it isn't for Claude Code CLI) and
        # whether a stable id like 'sub' exists for future keying. Remove later.
        if not getattr(ClaudeAPIMonitor, "_dbg_claims", False):
            ClaudeAPIMonitor._dbg_claims = True
            print(f"[claude-api][debug] /v1/messages JWT claim keys = {sorted(payload.keys())}")
        email = payload.get("email") or payload.get("email_address") or ""
        if not _looks_like_email(email):
            return

        _set_account_email(
            email,
            name=payload.get("name") or payload.get("full_name") or "",
            uuid_=str(payload.get("sub") or payload.get("user_id") or ""),
            source="api jwt",
        )

    def response(self, flow: http.HTTPFlow):
        if flow.request.host   != "api.anthropic.com": return
        # path includes query string, strip it before matching.
        # Cowork uses /v1/messages?beta=true — must still match.
        path = flow.request.path.split("?", 1)[0]
        if path != "/v1/messages":                      return
        if flow.request.method != "POST":               return

        try:
            req = json.loads(flow.request.content)
        except Exception:
            return

        model    = req.get("model", "unknown")
        messages = req.get("messages", [])
        prompt   = _extract_prompt_api(messages)
        client   = _detect_client(flow.request.headers)

        # Body-based detection only refines when headers are ambiguous.
        #   - Cowork tools (mcp__cowork__*) → claude-desktop-cowork (always wins,
        #     reliable because the marker is unique to Cowork).
        #   - Code-style tools without any header signal → fallback to
        #     claude-code-cli. CLI and Desktop "Code" tab share the same tools
        #     and beta=true URL, so we cannot reliably distinguish them by
        #     body alone — let _detect_client's header logic decide between
        #     claude-desktop-code / claude-code-vscode / claude-code-cli.
        if _looks_like_cowork(req, flow.request.headers):
            client = "claude-desktop-cowork"
        elif _looks_like_code(req) and client == "api":
            client = "claude-code-cli"

        resp_text = flow.response.content.decode("utf-8", errors="replace")
        ct        = flow.response.headers.get("content-type", "")
        is_sse    = "event-stream" in ct

        if is_sse:
            parsed = _parse_sse_api(resp_text)
        else:
            try:
                rj    = json.loads(resp_text)
                usage = rj.get("usage", {})
                rtext = "".join(
                    b.get("text", "") for b in rj.get("content", [])
                    if b.get("type") == "text"
                )
                parsed = dict(
                    response=rtext,
                    input_tokens          = usage.get("input_tokens", 0),
                    output_tokens         = usage.get("output_tokens", 0),
                    cache_read_tokens     = usage.get("cache_read_input_tokens", 0),
                    cache_creation_tokens = usage.get("cache_creation_input_tokens", 0),
                )
            except Exception:
                return

        self._log(flow, client, model, prompt, parsed)

    def _log(self, flow, client, model, prompt, parsed):
        inp = parsed["input_tokens"]
        out = parsed["output_tokens"]
        cr  = parsed.get("cache_read_tokens", 0)
        cw  = parsed.get("cache_creation_tokens", 0)

        email = current_email(flow)
        if not _should_log(email):
            print(f"[claude-api] SKIP (filter) | {client} | {model} | email={email or '(none)'}")
            return

        ip = _client_ip(flow)
        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                client,
            "account_email":         email,
            "client_ip":             ip,
            "machine_name":          ip,
            "model":                 model,
            "prompt":                prompt,
            "prompt_chars":          len(prompt),
            "response_chars":        len(parsed.get("response", "")),
            "input_tokens":          inp,
            "output_tokens":         out,
            "cache_creation_tokens": cw,
            "cache_read_tokens":     cr,
            "total_tokens":          inp + out + cr + cw,
            "cost_usd":              _calc_cost(model, inp, out, cr, cw),
            **_device_info(email),
        }

        _write_local(log)
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()

        print(f"[claude-api] {client} | {model} | "
              f"in={inp:,} out={out:,} | ${log['cost_usd']:.5f} | {_log_path().name}")


# ── mitmproxy addon: claude.ai Desktop ───────────────────────────────────────
class ClaudeDesktopMonitor:
    """
    Intercepts claude.ai /api/organizations/.../chat_conversations/.../completion
    This is the endpoint Claude.ai Desktop app uses for chat.
    """

    def response(self, flow: http.HTTPFlow):
        host = flow.request.host
        if "claude.ai" not in host:
            return
        if flow.request.method != "POST":
            return
        path = flow.request.path.split("?", 1)[0]
        if not _COMPLETION_RE.match(path):
            return

        ct     = flow.response.headers.get("content-type", "")
        status = flow.response.status_code

        # Parse request body
        try:
            req_body = json.loads(flow.request.content)
        except Exception:
            req_body = {}

        prompt = _extract_prompt_desktop(req_body)
        model  = req_body.get("model", "unknown")

        # Parse SSE response
        resp_text_raw = flow.response.content.decode("utf-8", errors="replace")
        is_sse = "event-stream" in ct

        if is_sse:
            parsed = _parse_sse_desktop(resp_text_raw)
            # If model wasn't in request, try from SSE
            if model == "unknown" and parsed.get("model"):
                model = parsed["model"]
        else:
            # Plain JSON fallback
            try:
                rj    = json.loads(resp_text_raw)
                usage = rj.get("usage", {})
                rtext = "".join(
                    b.get("text", "") for b in rj.get("content", [])
                    if b.get("type") == "text"
                )
                parsed = dict(
                    response=rtext,
                    input_tokens=usage.get("input_tokens", 0),
                    output_tokens=usage.get("output_tokens", 0),
                    cache_read_tokens=usage.get("cache_read_input_tokens", 0),
                    cache_creation_tokens=usage.get("cache_creation_input_tokens", 0),
                )
            except Exception:
                return

        inp = parsed["input_tokens"]
        out = parsed["output_tokens"]
        cr  = parsed.get("cache_read_tokens", 0)
        cw  = parsed.get("cache_creation_tokens", 0)

        email = current_email(flow)
        if not _should_log(email):
            print(f"[claude-desktop] SKIP (filter) | {model} | email={email or '(none)'}")
            return

        ip = _client_ip(flow)
        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                "claude-desktop",
            "account_email":         email,
            "client_ip":             ip,
            "machine_name":          ip,
            "model":                 model,
            "prompt":                prompt,
            "prompt_chars":          len(prompt),
            "response_chars":        len(parsed.get("response", "")),
            "input_tokens":          inp,
            "output_tokens":         out,
            "cache_creation_tokens": cw,
            "cache_read_tokens":     cr,
            "total_tokens":          inp + out + cr + cw,
            "cost_usd":              _calc_cost(model, inp, out, cr, cw),
            **_device_info(email),
        }

        _write_local(log)
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()

        print(f"[claude-desktop] {model} | prompt={len(prompt)}ch | "
              f"in={inp:,} out={out:,} | ${log['cost_usd']:.5f} | {_log_path().name}")


# Hosts to scan in discovery — covers Claude.ai web/desktop, Anthropic API,
# Cowork backend (dust.anthropic.com etc.), and any other anthropic/claude subdomain.
_DISCOVERY_HOSTS = ("anthropic.com", "claude.ai", "claudeusercontent.com")


# ── Discovery addon (keep for debugging other endpoints) ─────────────────────
class ClaudeDesktopDiscovery:
    """
    Logs non-completion POSTs to any monitored Anthropic/Claude host.
    Skips the completion endpoint (handled by ClaudeDesktopMonitor).
    """
    DISCOVERY_FILE = LOG_DIR / "claude_desktop_discovery.jsonl"
    SKIP_PATHS = {"/api/auth/", "/api/analytics", "/static/", "/favicon",
                  "/api/event_logging"}

    def response(self, flow: http.HTTPFlow):
        host = flow.request.host
        if not any(h in host for h in _DISCOVERY_HOSTS):
            return
        if flow.request.method != "POST":
            return

        path = flow.request.path
        path_no_query = path.split("?", 1)[0]

        # Skip already-handled completion endpoints (claude.ai + api.anthropic.com)
        if _COMPLETION_RE.match(path_no_query):
            return
        if host == "api.anthropic.com" and path_no_query == "/v1/messages":
            return

        if any(path.startswith(s) for s in self.SKIP_PATHS):
            return

        ct       = flow.response.headers.get("content-type", "")
        status   = flow.response.status_code
        req_size = len(flow.request.content)
        res_size = len(flow.response.content)

        entry = {
            "ts":     int(datetime.now().timestamp() * 1000),
            "host":   host,
            "path":   path,
            "status": status,
            "req_ct": flow.request.headers.get("content-type", ""),
            "res_ct": ct,
            "req_bytes": req_size,
            "res_bytes": res_size,
            "is_sse": "event-stream" in ct,
        }

        try:
            entry["req_preview"] = json.loads(flow.request.content)
        except Exception:
            entry["req_preview"] = flow.request.content[:200].decode("utf-8", errors="replace")

        try:
            with open(self.DISCOVERY_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass


# ── Account sniffer: auto-detect email from claude.ai API responses ─────────
def _looks_like_email(s) -> bool:
    return isinstance(s, str) and "@" in s and "." in s.split("@", 1)[1]


# Strict path matchers — only endpoints that return THE CURRENT USER's info,
# never lists of members / support emails / marketing config.
_CURRENT_ACCOUNT_RE = re.compile(r"^/api/auth/current_account$")
_ACCOUNT_RE         = re.compile(r"^/api/account/?$")
# Matches all bootstrap variants:
#   /api/bootstrap
#   /api/bootstrap/{org_uuid}
#   /edge-api/bootstrap/{org_uuid}/app_start   ← claude.ai web/desktop uses this
_BOOTSTRAP_RE       = re.compile(r"^/(api|edge-api)/bootstrap(/[^/]+){0,2}/?$")


def _extract_current_user(data) -> dict:
    """
    Pull current-user fields ONLY from well-known top-level shapes.
    No recursive search — that picks up support/marketing emails like
    hello@accoil.com which gets baked into Claude.ai org config blobs.
    """
    if not isinstance(data, dict):
        return {}

    # Shape A: /api/auth/current_account → {email_address, full_name, uuid, ...}
    # Shape B: /api/account              → {email_address, ...}
    if _looks_like_email(data.get("email_address")):
        return {
            "email": data["email_address"],
            "name":  data.get("full_name") or data.get("display_name") or "",
            "uuid":  data.get("uuid") or "",
        }

    # Shape C: /api/bootstrap/{org} → {"account": {email_address, ...}, ...}
    acct = data.get("account")
    if isinstance(acct, dict) and _looks_like_email(acct.get("email_address")):
        return {
            "email": acct["email_address"],
            "name":  acct.get("full_name") or "",
            "uuid":  acct.get("uuid") or "",
        }

    return {}


class ClaudeAccountSniffer:
    """
    Watches claude.ai responses and caches the current user's email.

    Strategy:
      1. WHITELIST (trusted): exact paths that return current user only.
         Use these results immediately and stop.
      2. DISCOVERY (debug):  any other claude.ai JSON response that has a
         top-level `email_address` or `account.email_address`. We print
         the path so we can learn the real endpoints, but DO NOT cache
         the value (could be a member list / support address).
    """

    WHITELIST_RES = [_CURRENT_ACCOUNT_RE, _ACCOUNT_RE, _BOOTSTRAP_RE]
    _SEEN_PATHS = set()  # avoid printing the same discovery line repeatedly

    def response(self, flow: http.HTTPFlow):
        if "claude.ai" not in flow.request.host:
            return
        path = flow.request.path.split("?", 1)[0]

        if "json" not in flow.response.headers.get("content-type", ""):
            return

        try:
            data = json.loads(flow.response.content)
        except Exception:
            return

        info = _extract_current_user(data)

        # Whitelisted endpoint → map this claude.ai session cookie → email.
        if info and any(rgx.match(path) for rgx in self.WHITELIST_RES):
            sess = _session_key(flow)
            if sess:
                _set_session_email(sess, info["email"],
                                   name=info.get("name", ""),
                                   uuid_=info.get("uuid", ""))
            else:
                print(f"[claude-account] ⚠ no sessionKey cookie on {path} — cannot map {info['email']}")
            return

        # Non-whitelisted but contains a current-user-shaped email → log for review
        if info and path not in self._SEEN_PATHS:
            self._SEEN_PATHS.add(path)
            print(f"[claude-account] ? candidate path: {path} → email_address={info['email']}  "
                  f"(add to whitelist if this is the current user)")


# ── Bridge WebSocket monitor (Claude Code / VSCode account-login) ───────────
class ClaudeBridgeMonitor:
    """
    Parses bridge.claudeusercontent.com WebSocket sessions into structured logs.

    Bridge protocol variants handled:
      A) Wrapped HTTP: {type:"request", id, body:{model, messages, ...}}
         Response:     {type:"stream_event"|"response", id, data:"...SSE..."}
      B) Raw API:      top-level {messages:[...], model:...} (no wrapper)
         Response:     SSE events forwarded as-is (same as api.anthropic.com)
      C) Unknown:      logged to discovery file and skipped
    """

    # Map bridge client_type → our log client string
    _CLIENT_MAP = {
        "claude-code":      "claude-code-cli",
        "cli":              "claude-code-cli",
        "vscode":           "claude-code-vscode",
        "chrome-extension": "browser-extension",
    }

    def __init__(self):
        self._sessions = {}   # id(flow) -> session dict

    # ── mitmproxy hooks ──────────────────────────────────────────────────────

    def websocket_start(self, flow: http.HTTPFlow):
        if "bridge.claudeusercontent.com" not in flow.request.host:
            return
        # Infer client from HTTP headers on the WS upgrade request
        client = _detect_client(flow.request.headers)
        self._sessions[id(flow)] = {
            "client":  client,
            "src_ip":  _client_ip(flow),
            "pending": {},        # req_id -> req state
        }
        print(f"[claude-bridge] WS opened path={flow.request.path} client={client}")

    def websocket_end(self, flow: http.HTTPFlow):
        sess = self._sessions.pop(id(flow), None)
        # Flush any incomplete requests (e.g. connection dropped mid-stream)
        if sess:
            for req_id in list(sess["pending"]):
                self._flush(sess, req_id)

    def websocket_message(self, flow: http.HTTPFlow):
        if "bridge.claudeusercontent.com" not in flow.request.host:
            return
        sess = self._sessions.get(id(flow))
        if sess is None:
            return

        msg = flow.websocket.messages[-1]
        if not msg.is_text or not msg.content:
            return

        try:
            text = msg.content.decode("utf-8", errors="replace")
            data = json.loads(text)
        except Exception:
            return

        t = data.get("type", "")

        # Update client identity when we see the connect handshake
        if t == "connect" and msg.from_client:
            ct = data.get("client_type", "")
            if ct in self._CLIENT_MAP:
                sess["client"] = self._CLIENT_MAP[ct]

            # Pull email from connect payload — Claude Code (subscription)
            # logs in via the bridge WS instead of claude.ai HTTP, so the
            # HTTP-based ClaudeAccountSniffer never sees the email. The
            # connect handshake carries account info, e.g.:
            #   {"type":"connect","client_type":"claude-code",
            #    "account":{"email_address":"x@y.com","uuid":"..."}}
            # Field name varies — try the common shapes.
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
                sess["email"] = bridge_email
                _set_account_email(
                    bridge_email,
                    name=acct_blob.get("full_name") or acct_blob.get("name") or "",
                    uuid_=acct_blob.get("uuid") or "",
                    source="bridge",
                )

            # Capture device_id from connect handshake if present (keyed by email)
            device_id = str(data.get("device_id") or "")
            if device_id and sess.get("email"):
                slot = dict(_DEVICE_BY_EMAIL.get(sess["email"], {}))
                if slot.get("device_id") != device_id:
                    slot["device_id"] = device_id
                    _DEVICE_BY_EMAIL[sess["email"]] = slot
                    print(f"[claude-bridge] device_id: {device_id[:16]}...")
            return

        if t in ("ping", "pong", "error"):
            return

        # Capture device_id from any message carrying target_device_id (e.g. tool_call)
        tid = str(data.get("target_device_id") or "")
        if tid and sess.get("email"):
            slot = dict(_DEVICE_BY_EMAIL.get(sess["email"], {}))
            if not slot.get("device_id"):
                slot["device_id"] = tid
                _DEVICE_BY_EMAIL[sess["email"]] = slot

        if msg.from_client:
            self._handle_request(sess, data)
        else:
            self._handle_response(sess, data)

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _handle_request(self, sess, data):
        """Detect outbound API request and start tracking it."""
        req_id = data.get("id") or data.get("request_id")

        # Unwrap possible envelope formats
        body = (
            data.get("body") or
            data.get("params") or
            data.get("request") or
            (data if "messages" in data else None)
        )

        if not isinstance(body, dict) or "messages" not in body:
            return

        model  = body.get("model", "unknown")
        prompt = _extract_prompt_api(body["messages"])

        if req_id is None:
            req_id = str(uuid.uuid4())

        sess["pending"][req_id] = {
            "model":    model,
            "prompt":   prompt,
            "response": "",
            "inp": 0, "out": 0, "cr": 0, "cw": 0,
        }
        print(f"[claude-bridge] → req {str(req_id)[:8]} | {model} | prompt={len(prompt)}ch")

    def _handle_response(self, sess, data):
        """Accumulate streaming response events and flush on completion."""
        t      = data.get("type", "")
        req_id = data.get("id") or data.get("request_id")

        # Resolve which pending request this belongs to
        if req_id and req_id in sess["pending"]:
            req = sess["pending"][req_id]
        elif len(sess["pending"]) == 1:
            req_id = next(iter(sess["pending"]))
            req    = sess["pending"][req_id]
        else:
            return

        # --- Format A: SSE text wrapped in a data/body field ---
        sse_payload = data.get("data") or data.get("body") or data.get("sse") or ""
        if isinstance(sse_payload, str) and sse_payload:
            parsed = _parse_sse_api(sse_payload)
            req["response"] += parsed.get("response", "")
            if parsed.get("input_tokens"):          req["inp"] = parsed["input_tokens"]
            if parsed.get("output_tokens"):         req["out"] = parsed["output_tokens"]
            if parsed.get("cache_read_tokens"):     req["cr"]  = parsed["cache_read_tokens"]
            if parsed.get("cache_creation_tokens"): req["cw"]  = parsed["cache_creation_tokens"]

        # --- Format B: raw SSE event types forwarded as JSON ---
        if t == "message_start":
            u = data.get("message", {}).get("usage", {})
            req["inp"] = u.get("input_tokens",               req["inp"])
            req["cr"]  = u.get("cache_read_input_tokens",    req["cr"])
            req["cw"]  = u.get("cache_creation_input_tokens",req["cw"])
        elif t == "content_block_delta":
            req["response"] += data.get("delta", {}).get("text", "")
        elif t == "message_delta":
            req["out"] = data.get("usage", {}).get("output_tokens", req["out"])

        # Completion signals
        if t in ("message_stop", "done", "complete", "end") or data.get("done"):
            self._flush(sess, req_id)

    def _flush(self, sess, req_id):
        req = sess["pending"].pop(req_id, None)
        if not req or not req["prompt"]:
            return

        model = req["model"]
        prompt = req["prompt"]
        inp, out = req["inp"], req["out"]
        cr, cw   = req["cr"],  req["cw"]

        email = sess.get("email", "")
        if not _should_log(email):
            print(f"[claude-bridge] SKIP (filter) | {sess['client']} | {model} | email={email or '(none)'}")
            return

        ip = sess["src_ip"]
        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                sess["client"],
            "account_email":         email,
            "client_ip":             ip,
            "machine_name":          ip,
            "model":                 model,
            "prompt":                prompt,
            "prompt_chars":          len(prompt),
            "response_chars":        len(req["response"]),
            "input_tokens":          inp,
            "output_tokens":         out,
            "cache_creation_tokens": cw,
            "cache_read_tokens":     cr,
            "total_tokens":          inp + out + cr + cw,
            "cost_usd":              _calc_cost(model, inp, out, cr, cw),
            **_device_info(email),
        }

        _write_local(log)
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()
        print(f"[claude-bridge] ✓ {sess['client']} | {model} | "
              f"prompt={len(prompt)}ch | in={inp:,} out={out:,} | ${log['cost_usd']:.5f}")


# ── Bridge WebSocket discovery (Claude Code account-login) ──────────────────
class ClaudeBridgeDiscovery:
    """
    Claude Code CLI / VSCode with account login uses a WebSocket to
    bridge.claudeusercontent.com instead of the REST API.

    This addon logs all WebSocket frames to log/claude_bridge_discovery.jsonl
    so we can learn the protocol and add proper monitoring.

    Once we know the message format, we can add parsing/logging similar to
    ClaudeDesktopMonitor.
    """
    BRIDGE_FILE = LOG_DIR / "claude_bridge_discovery.jsonl"

    def websocket_start(self, flow: http.HTTPFlow):
        if "bridge.claudeusercontent.com" not in flow.request.host:
            return
        entry = {
            "ts":    int(datetime.now().timestamp() * 1000),
            "event": "ws_start",
            "host":  flow.request.host,
            "path":  flow.request.path,
            "ua":    flow.request.headers.get("user-agent", ""),
        }
        self._write(entry)
        print(f"[claude-bridge] WS opened {flow.request.path}")

    # Message types that ClaudeBridgeMonitor already handles — skip in discovery
    _MONITOR_TYPES = {
        "connect", "ping", "pong",
        "request", "response",
        "message_start", "content_block_start", "content_block_delta",
        "content_block_stop", "message_delta", "message_stop",
        "stream_event", "done", "complete", "end",
    }

    def websocket_message(self, flow: http.HTTPFlow):
        if "bridge.claudeusercontent.com" not in flow.request.host:
            return
        if flow.websocket is None or not flow.websocket.messages:
            return
        msg = flow.websocket.messages[-1]

        direction = "client_to_server" if msg.from_client else "server_to_client"
        content   = msg.content
        size      = len(content) if content else 0

        entry = {
            "ts":        int(datetime.now().timestamp() * 1000),
            "event":     "ws_msg",
            "direction": direction,
            "is_text":   msg.is_text,
            "size":      size,
        }

        parsed_json = None
        if msg.is_text and content:
            try:
                text = content.decode("utf-8", errors="replace")
                try:
                    parsed_json = json.loads(text)
                    entry["json"] = parsed_json
                except Exception:
                    entry["text_preview"] = text[:500]
            except Exception:
                entry["raw_preview"] = repr(content[:200])
        else:
            entry["raw_preview"] = repr(content[:200]) if content else ""

        # Skip types already handled by ClaudeBridgeMonitor
        if parsed_json and parsed_json.get("type") in self._MONITOR_TYPES:
            return

        self._write(entry)
        print(f"[claude-bridge-discovery] WS {direction} | {size}b {'text' if msg.is_text else 'binary'}")

    def _write(self, entry: dict):
        try:
            with open(self.BRIDGE_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass


# ── Connection sniffer: log every host the client tries to reach ────────────
class ClaudeConnectionLogger:
    """
    Logs SNI hostname of every TLS connection attempt — including hosts that
    are passed through (not MITM'd). Use this to discover unknown hosts that
    Cowork / Claude Desktop reaches but our addons can't see.

    Each unique SNI is logged once per session.
    """
    CONN_FILE = LOG_DIR / "claude_connections.jsonl"
    _SEEN = set()

    def tls_clienthello(self, data):
        try:
            sni = (data.client_hello.sni or "").lower()
        except Exception:
            return
        if not sni or sni in self._SEEN:
            return
        self._SEEN.add(sni)

        entry = {
            "ts":  int(datetime.now().timestamp() * 1000),
            "sni": sni,
        }
        try:
            with open(self.CONN_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass
        print(f"[claude-conn] SNI seen: {sni}")


# ── Claude Code metrics monitor ──────────────────────────────────────────────
class ClaudeCodeMetricsMonitor:
    """
    Intercepts POST api.anthropic.com/api/claude_code/metrics to capture
    OS/arch/app-version/terminal + account_id/org_id, keyed by user.email.
    Runs on .request() so the cache is ready before the next /v1/messages call.
    """

    def request(self, flow: http.HTTPFlow):
        if flow.request.host != "api.anthropic.com":
            return
        if flow.request.path.split("?", 1)[0] != "/api/claude_code/metrics":
            return
        if flow.request.method != "POST":
            return

        try:
            body = json.loads(flow.request.content)
        except Exception:
            return

        res = body.get("resource_attributes") or {}

        terminal = ""
        for m in body.get("metrics") or []:
            for dp in m.get("data_points") or []:
                t = (dp.get("attributes") or {}).get("terminal.type") or ""
                if t:
                    terminal = str(t)
                    break
            if terminal:
                break

        # Pull user identity from the first data_point that has user.email.
        # All metric types (session.count, cost.usage, token.usage, etc.) carry
        # the same user fields — grab the first one found.
        dp_attrs: dict = {}
        for m in body.get("metrics") or []:
            for dp in m.get("data_points") or []:
                a = dp.get("attributes") or {}
                if isinstance(a, dict) and _looks_like_email(str(a.get("user.email", ""))):
                    dp_attrs = a
                    break
            if dp_attrs:
                break

        # No user.email in this batch → nothing to key the device cache on.
        metrics_email = str(dp_attrs.get("user.email") or "")
        if not _looks_like_email(metrics_email):
            return

        # Link this session's OAuth token → email. The same token is sent on the
        # user's /v1/messages prompts (whose JWT carries NO email claim), so this
        # lets current_email() resolve those prompts by token — replacing the old
        # per-IP correlation (VPN-safe). Refreshed automatically on token rotation.
        tok = _bearer_key(flow)
        if tok and _EMAIL_BY_TOKEN.get(tok) != metrics_email:
            _EMAIL_BY_TOKEN[tok] = metrics_email
            print(f"[claude-metrics] token → {metrics_email}")

        slot = dict(_DEVICE_BY_EMAIL.get(metrics_email, {}))
        for src, dst in [
            ("service.version", "app_version"),
            ("os.type",         "os_type"),
            ("os.version",      "os_version"),
            ("host.arch",       "host_arch"),
        ]:
            v = str(res.get(src) or "")
            if v:
                slot[dst] = v
        if terminal:
            slot["terminal"] = terminal

        # device_id = user.account_uuid (stable per account, VPN-independent)
        account_uuid = str(dp_attrs.get("user.account_uuid") or "")
        if account_uuid and not slot.get("device_id"):
            slot["device_id"] = account_uuid

        # mac_address: not present in any Claude Code traffic — leave empty
        device_changed = slot != _DEVICE_BY_EMAIL.get(metrics_email)
        _DEVICE_BY_EMAIL[metrics_email] = slot

        # Update account identity from metrics (keyed by email — VPN-safe).
        account_id = str(dp_attrs.get("user.account_id") or "")
        org_id     = str(dp_attrs.get("organization.id") or "")
        _set_account_email(metrics_email,
                           uuid_=account_uuid,
                           account_id=account_id,
                           org_id=org_id,
                           source="metrics")
        # Persist device attrs too (account-only change above may not have fired).
        if device_changed:
            _persist_identity()

        print(f"[claude-metrics] {metrics_email} ver={slot.get('app_version')} "
              f"os={slot.get('os_type')}/{slot.get('os_version')} "
              f"arch={slot.get('host_arch')} terminal={terminal} "
              f"uuid={account_uuid[:8] + '...' if account_uuid else '-'}")


# ── Segment analytics monitor — REMOVED ─────────────────────────────────────
# Previously intercepted a-api.anthropic.com/v1/b to capture anonymousId + email
# keyed by client IP (a browser-VPN-safe fallback). IP is no longer used as
# identity, and that host doesn't carry the claude.ai session cookie, so the
# Segment batch can't be correlated to a chat session — anon_id is now vestigial.
# Browser/Desktop chat email now comes from the session-cookie map
# (ClaudeAccountSniffer); Cowork/Desktop-Code go through /v1/messages with a JWT.


# ── TEMPORARY identity debug ─────────────────────────────────────────────────
# Writes one line per /v1/messages and /api/claude_code/metrics request to
# log/identity_debug.jsonl so we can see (from a file, not console) WHY email
# isn't resolving: does each endpoint carry a Bearer token, do the two tokens
# MATCH (same tok_key), what JWT claims exist, and is there a body user_id.
# Remove this class + its addons entry once identity is confirmed working.
class IdentityDebug:
    FILE = LOG_DIR / "identity_debug.jsonl"

    def request(self, flow: http.HTTPFlow):
        if flow.request.host != "api.anthropic.com":
            return
        ep = flow.request.path.split("?", 1)[0]
        if ep not in ("/v1/messages", "/api/claude_code/metrics"):
            return

        auth = flow.request.headers.get("Authorization", "") or \
               flow.request.headers.get("authorization", "")
        scheme, tok_key, claims = "(none)", "", []
        if auth:
            scheme = auth.split(" ", 1)[0].lower() or "(raw)"
            if auth.lower().startswith("bearer "):
                t = auth[7:].strip()
                if t.startswith("sk-"):
                    scheme = "sk-key"
                elif t:
                    tok_key = hashlib.sha256(t.encode("utf-8")).hexdigest()[:12]
                    claims  = sorted(_decode_jwt_payload(t).keys())

        meta_user = ""
        try:
            body = json.loads(flow.request.content)
            meta = body.get("metadata") or {}
            meta_user = str(meta.get("user_id", "")) if isinstance(meta, dict) else ""
        except Exception:
            pass

        entry = {
            "ts":           int(datetime.now().timestamp() * 1000),
            "ep":           "messages" if ep == "/v1/messages" else "metrics",
            "auth_scheme":  scheme,
            "tok_key":      tok_key,        # sha256[:12] — compare across endpoints
            "jwt_claims":   claims,         # claim KEYS only (no values)
            "acct_uuid":    _meta_account_uuid(flow),   # extracted from metadata.user_id
            "resolved":     current_email(flow),        # ← does identity resolve now?
        }
        try:
            with open(self.FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass


# Seed the identity map from disk + manual roster before traffic starts.
_load_identity_seed()

addons = [
    IdentityDebug(),               # TEMP: diagnose why email isn't resolving (remove later)
    ClaudeConnectionLogger(),      # log all hosts client connects to (incl. passthrough)
    ToolSchemaFixer(),             # rewrite tool input_schema with top-level oneOf/allOf/anyOf
    ClaudeAccountSniffer(),        # detect email first so completions know it
    ClaudeCodeMetricsMonitor(),    # capture OS/arch/version + account_id/org_id (keyed by email)
    ClaudeAPIMonitor(),            # api.anthropic.com (API key / Claude Code CLI & VSCode)
    ClaudeDesktopMonitor(),        # claude.ai chat completion (Desktop app / browser)
    ClaudeDesktopDiscovery(),      # log other claude.ai POSTs for debugging
    ClaudeBridgeMonitor(),         # bridge.claudeusercontent.com — Claude Code OAuth sessions
    ClaudeBridgeDiscovery(),       # log unknown bridge WS frames for debugging
]
