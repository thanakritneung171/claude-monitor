"""
Claude Monitor — mitmproxy addon
Intercepts Claude API calls and logs to Cloudflare Worker + local JSONL.

Targets:
  - api.anthropic.com/v1/messages  (API key / Claude Code)
  - claude.ai  (Claude Desktop app — discovery + logging)

Usage:
    mitmdump -s addon.py --listen-port 8080
"""

import json
import os
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

HOSTNAME = socket.gethostname()

# ── Local log directory (../log relative to this file) ───────────────────────
LOG_DIR  = Path(__file__).parent.parent / "log"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "claude.jsonl"   # rotate ทุกวันโดย date suffix

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
    if "claude" in ua or "anthropic" in ua:
        return "desktop"
    return "api"


# ── SSE stream parser ─────────────────────────────────────────────────────────
def _parse_sse(text: str) -> dict:
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


# ── Extract last user prompt ──────────────────────────────────────────────────
def _extract_prompt(messages: list) -> str:
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


# ── Fire-and-forget HTTP POST to Worker ──────────────────────────────────────
def _send_log(payload: dict):
    try:
        body = json.dumps(payload).encode()
        req  = urllib.request.Request(f"{WORKER_URL}/log", data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Api-Key",    API_KEY)
        urllib.request.urlopen(req, timeout=8)
    except Exception:
        pass


# ── mitmproxy addon ───────────────────────────────────────────────────────────
class ClaudeMonitor:
    def response(self, flow: http.HTTPFlow):
        if flow.request.host   != "api.anthropic.com": return
        if flow.request.path   != "/v1/messages":       return
        if flow.request.method != "POST":               return

        # Parse request body
        try:
            req = json.loads(flow.request.content)
        except Exception:
            return

        model    = req.get("model", "unknown")
        messages = req.get("messages", [])
        prompt   = _extract_prompt(messages)
        client   = _detect_client(flow.request.headers)

        # Parse response (handles both streaming SSE and plain JSON)
        resp_text = flow.response.content.decode("utf-8", errors="replace")
        ct        = flow.response.headers.get("content-type", "")
        is_sse    = "event-stream" in ct

        if is_sse:
            parsed = _parse_sse(resp_text)
        else:
            try:
                rj     = json.loads(resp_text)
                usage  = rj.get("usage", {})
                rtext  = "".join(
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

        inp = parsed["input_tokens"]
        out = parsed["output_tokens"]
        cr  = parsed["cache_read_tokens"]
        cw  = parsed["cache_creation_tokens"]

        log = {
            "id":                    str(uuid.uuid4()),
            "ts":                    int(datetime.now().timestamp() * 1000),
            "client":                client,
            "machine_name":          HOSTNAME,
            "model":                 model,
            "prompt":                prompt,
            "prompt_chars":          len(prompt),
            "response_chars":        len(parsed["response"]),
            "input_tokens":          inp,
            "output_tokens":         out,
            "cache_creation_tokens": cw,
            "cache_read_tokens":     cr,
            "total_tokens":          inp + out + cr + cw,
            "cost_usd":              _calc_cost(model, inp, out, cr, cw),
        }

        # ── Write local log (sync, fast) ─────────────────────────────────
        _write_local(log)

        # ── Send to Cloudflare Worker (async) ─────────────────────────────
        threading.Thread(target=_send_log, args=(log,), daemon=True).start()

        print(f"[claude-monitor] {client} | {model} | "
              f"in={inp:,} out={out:,} cr={cr:,} cw={cw:,} | "
              f"${log['cost_usd']:.5f} | logged to {_log_path().name}")


class ClaudeDesktopDiscovery:
    """
    Discovery mode for Claude.ai Desktop app.
    Logs every POST to claude.ai so we can find the right completion endpoint.
    Discovery file: log/claude_desktop_discovery.jsonl
    """
    DISCOVERY_FILE = LOG_DIR / "claude_desktop_discovery.jsonl"
    SKIP_PATHS = {"/api/auth/", "/api/analytics", "/static/", "/favicon"}

    def response(self, flow: http.HTTPFlow):
        host = flow.request.host
        if "claude.ai" not in host:
            return
        if flow.request.method != "POST":
            return

        path = flow.request.path
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

        # Try to parse request body for preview
        try:
            entry["req_preview"] = json.loads(flow.request.content)
        except Exception:
            entry["req_preview"] = flow.request.content[:200].decode("utf-8", errors="replace")

        # Write to discovery log
        try:
            with open(self.DISCOVERY_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass

        sse_mark = " [SSE]" if entry["is_sse"] else ""
        print(f"[claude-desktop]{sse_mark} {status} POST {path} | req={req_size}b res={res_size}b")


addons = [ClaudeMonitor(), ClaudeDesktopDiscovery()]
