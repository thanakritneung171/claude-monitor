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
    WORKER_URL    = config.WORKER_URL.rstrip("/")
    API_KEY       = config.API_KEY
    ACCOUNT_EMAIL = getattr(config, "ACCOUNT_EMAIL", "")
except ImportError:
    raise SystemExit("config.py not found — copy config.example.py → config.py and fill in values.")

HOSTNAME = socket.gethostname()

# ── Local log directory (../log relative to this file) ───────────────────────
LOG_DIR  = Path(__file__).parent.parent / "log"
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


# ── Client detection ──────────────────────────────────────────────────────────
def _detect_client(headers) -> str:
    ua   = str(headers.get("user-agent",            "")).lower()
    name = str(headers.get("anthropic-client-name", "")).lower()
    app  = str(headers.get("x-app",                 "")).lower()
    if "claude-code" in name or "claude-code" in ua or "claude-code" in app:
        return "claude-code"
    if "vscode" in ua or "vscode" in name:
        return "vscode"
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
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        content = m.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    return block.get("text", "")
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
        if flow.request.path   != "/v1/messages":       return
        if flow.request.method != "POST":               return

        try:
            req = json.loads(flow.request.content)
        except Exception:
            return

        model    = req.get("model", "unknown")
        messages = req.get("messages", [])
        prompt   = _extract_prompt_api(messages)
        client   = _detect_client(flow.request.headers)

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
            "account_email":         ACCOUNT_EMAIL,
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
        if not _COMPLETION_RE.match(flow.request.path):
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
            "account_email":         ACCOUNT_EMAIL,
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


# ── Discovery addon (keep for debugging other endpoints) ─────────────────────
class ClaudeDesktopDiscovery:
    """
    Logs non-completion POSTs to claude.ai for debugging.
    Skips the completion endpoint (handled by ClaudeDesktopMonitor).
    """
    DISCOVERY_FILE = LOG_DIR / "claude_desktop_discovery.jsonl"
    SKIP_PATHS = {"/api/auth/", "/api/analytics", "/static/", "/favicon",
                  "/api/event_logging"}

    def response(self, flow: http.HTTPFlow):
        host = flow.request.host
        if "claude.ai" not in host:
            return
        if flow.request.method != "POST":
            return

        path = flow.request.path

        # Skip already-handled completion endpoint
        if _COMPLETION_RE.match(path):
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


addons = [ClaudeAPIMonitor(), ClaudeDesktopMonitor(), ClaudeDesktopDiscovery()]
