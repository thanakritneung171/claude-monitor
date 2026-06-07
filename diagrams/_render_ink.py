"""Render .mmd files to PNG via mermaid.ink web service."""
import base64
import urllib.request
import urllib.error
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
mmd_files = sorted(HERE.glob("*.mmd"))

if not mmd_files:
    print("no .mmd files found")
    sys.exit(1)

ok = 0
for mmd in mmd_files:
    text = mmd.read_text(encoding="utf-8")
    # mermaid.ink expects base64-url-encoded source
    enc = base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii")
    url = f"https://mermaid.ink/img/{enc}?type=png&bgColor=ffffff"
    out = HERE / (mmd.stem + ".png")
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (mermaid renderer)"
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        out.write_bytes(data)
        size_kb = len(data) // 1024
        print(f"[ok ] {out.name}  ({size_kb} KB)")
        ok += 1
    except urllib.error.HTTPError as e:
        print(f"[err] {mmd.name}: HTTP {e.code} — {e.reason}")
    except Exception as e:
        print(f"[err] {mmd.name}: {type(e).__name__}: {e}")

print(f"\n{ok}/{len(mmd_files)} rendered")
