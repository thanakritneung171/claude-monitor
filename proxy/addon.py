"""
Claude Monitor — mitmproxy addon
Intercepts Claude API calls and logs to Cloudflare Worker + local JSONL.

Targets:
  - api.anthropic.com/v1/messages           (API key / Claude Code with ANTHROPIC_BASE_URL)
  - claude.ai  /api/organizations/.../chat_conversations/.../completion  (Claude Desktop app)

Usage:
    mitmdump -s addon.py --listen-port 8080 --allow-hosts "claude.ai"
"""

import json
import os
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

# Account info cache — auto-populated by ClaudeAccountSniffer from claude.ai API responses.
# If no email is detected (e.g., API key users), account_email stays empty.
_ACCOUNT = {
    "email":    "",
    "name":     "",
    "uuid":     "",
    "org_uuid": "",
}

def current_email() -> str:
    return _ACCOUNT["email"]

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


# ── Client detection ──────────────────────────────────────────────────────────
def _detect_client(headers) -> str:
    ua   = str(headers.get("user-agent",            "")).lower()
    name = str(headers.get("anthropic-client-name", "")).lower()
    app  = str(headers.get("x-app",                 "")).lower()
    ctx  = str(headers.get("x-client-context",      "")).lower()

    if "claude-code" in name or "claude-code" in ua or "claude-code" in app:
        # VSCode extension injects x-client-context: vscode, or shows electron/vscode in UA
        if "vscode" in ctx or "vscode" in ua or "visual-studio-code" in ua:
            return "claude-code-vscode"
        return "claude-code-cli"

    if "vscode" in ua or "vscode" in name or "vscode" in ctx:
        return "claude-code-vscode"

    if "electron" in ua or "claude" in ua or "anthropic" in ua:
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


# ── mitmproxy addon: api.anthropic.com ───────────────────────────────────────
class ClaudeAPIMonitor:
    """Intercepts api.anthropic.com/v1/messages (API key users)."""

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

        # Cowork = Desktop hitting /v1/messages?beta=true with cowork tools / metadata.
        # Regular Desktop chat goes through claude.ai/.../chat_conversations, never here.
        if client == "claude-desktop":
            client = "claude-desktop-cowork"
        elif client == "api" and _looks_like_cowork(req, flow.request.headers):
            client = "claude-desktop-cowork"

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

        self._log(client, model, prompt, parsed)

    def _log(self, client, model, prompt, parsed):
        inp = parsed["input_tokens"]
        out = parsed["output_tokens"]
        cr  = parsed.get("cache_read_tokens", 0)
        cw  = parsed.get("cache_creation_tokens", 0)

        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                client,
            "account_email":         current_email(),
            "machine_name":          HOSTNAME,
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

        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                "claude-desktop",
            "account_email":         current_email(),
            "machine_name":          HOSTNAME,
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

        # Whitelisted endpoint → trust + cache
        if info and any(rgx.match(path) for rgx in self.WHITELIST_RES):
            email = info["email"]
            if email != _ACCOUNT["email"]:
                _ACCOUNT["email"] = email
                _ACCOUNT["name"]  = info.get("name", "") or _ACCOUNT["name"]
                _ACCOUNT["uuid"]  = info.get("uuid", "") or _ACCOUNT["uuid"]
                print(f"[claude-account] ✓ detected email: {email} (from {path})")
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
            return

        if t in ("ping", "pong", "error"):
            return

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

        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                sess["client"],
            "account_email":         current_email(),
            "machine_name":          HOSTNAME,
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


addons = [
    ClaudeConnectionLogger(),   # log all hosts client connects to (incl. passthrough)
    ClaudeAccountSniffer(),     # detect email first so completions know it
    ClaudeAPIMonitor(),         # api.anthropic.com (API key / Claude Code CLI & VSCode)
    ClaudeDesktopMonitor(),     # claude.ai chat completion (Desktop app / browser)
    ClaudeDesktopDiscovery(),   # log other claude.ai POSTs for debugging
    ClaudeBridgeMonitor(),      # bridge.claudeusercontent.com — Claude Code OAuth sessions
    ClaudeBridgeDiscovery(),    # log unknown bridge WS frames for debugging
]
