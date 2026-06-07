"""Extract mermaid blocks from IDENTITY-LAYERS-PLAN.md into separate .mmd files."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC  = ROOT / "IDENTITY-LAYERS-PLAN.md"
OUT  = ROOT / "diagrams"
OUT.mkdir(exist_ok=True)

text = SRC.read_text(encoding="utf-8")

# Map heading → output filename
NAMES = {
    "3.1": "01-architecture",
    "3.3": "02-capture-flow",
    "3.4": "03-log-arrival",
    "3.5": "04-display-logic",
    "3.6": "05-deploy-timeline",
}

# Find all ### headings and the mermaid block following each
heading_re = re.compile(r"^### (3\.\d)\s+(.+?)$", re.MULTILINE)
mermaid_re = re.compile(r"```mermaid\n(.*?)```", re.DOTALL)

headings = [(m.group(1), m.group(2), m.start()) for m in heading_re.finditer(text)]

written = 0
for i, (num, title, start) in enumerate(headings):
    if num not in NAMES:
        continue
    end = headings[i + 1][2] if i + 1 < len(headings) else len(text)
    chunk = text[start:end]
    m = mermaid_re.search(chunk)
    if not m:
        continue
    body = m.group(1).rstrip()
    out_path = OUT / f"{NAMES[num]}.mmd"
    out_path.write_text(body, encoding="utf-8")
    print(f"wrote {out_path.name}  ({len(body)} bytes)")
    written += 1

print(f"\ntotal: {written} mermaid blocks extracted")
