"""
Seed account_uuid -> email mappings into proxy/identity_cache.json from the
Segment analytics (/v1/b) batches captured in log/claude_desktop_discovery.jsonl.

WHY: Cowork / Claude Desktop hit api.anthropic.com/v1/messages with a raw sk-
key + an account_uuid in metadata, but never emit /api/claude_code/metrics, so
they have no automatic email source and every call gets dropped by the
@softdebut filter (resolved email = ""). claude.ai's Segment identify/track
events DO carry userId (= account_uuid) right next to the email, so this
recovers the uuid->email link for EVERY such user at once — not one at a time.

Claude Code CLI / VSCode already self-resolve via metrics; this fills the gap
for Cowork + Desktop. Run once, then restart the proxy (the seed is loaded at
startup by _load_identity_seed). Safe to re-run: idempotent, never overwrites an
existing mapping, and writes identity_cache.json.bak before saving.
"""
import collections
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
DISCOVERY = HERE.parent / "log" / "claude_desktop_discovery.jsonl"
CACHE = HERE / "identity_cache.json"


def looks_like_email(s) -> bool:
    return isinstance(s, str) and "@" in s and "." in s.split("@", 1)[1]


def walk(node, cur_uid, pairs):
    """Recurse a Segment batch item; attach any email to the nearest userId."""
    if isinstance(node, dict):
        uid = node.get("userId") or cur_uid
        for k, v in node.items():
            if k in ("email", "email_address") and looks_like_email(v) and uid:
                pairs[uid][v] += 1
            walk(v, uid, pairs)
    elif isinstance(node, list):
        for it in node:
            walk(it, cur_uid, pairs)


def main():
    pairs = collections.defaultdict(collections.Counter)  # uuid -> {email: count}
    with open(DISCOVERY, encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("path") != "/v1/b":
                continue
            rp = e.get("req_preview")
            if isinstance(rp, dict):
                for item in rp.get("batch") or []:
                    walk(item, None, pairs)

    # One email per uuid = most frequent; record conflicts for review.
    resolved, conflicts = {}, {}
    for uid, ems in pairs.items():
        if len(ems) > 1:
            conflicts[uid] = dict(ems)
        resolved[uid] = ems.most_common(1)[0][0]

    cache = json.loads(CACHE.read_text(encoding="utf-8"))
    uuid_email = cache.setdefault("uuid_email", {})

    added = {uid: em for uid, em in resolved.items() if uid not in uuid_email}

    if added:
        shutil.copy2(CACHE, CACHE.with_name("identity_cache.json.bak"))
        uuid_email.update(added)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    print(f"Segment /v1/b: {len(resolved)} distinct account_uuid -> email found")
    print(f"already mapped: {len(resolved) - len(added)} | newly added: {len(added)}")
    if added:
        print("\nNEW mappings added to identity_cache.json:")
        for uid, em in sorted(added.items(), key=lambda kv: kv[1]):
            print(f"  {uid}  ->  {em}")
    if conflicts:
        print("\n⚠ uuid with >1 email in Segment (used most-frequent, verify):")
        for uid, ems in conflicts.items():
            print(f"  {uid}: {ems}")
    print(f"\nuuid_email total now: {len(uuid_email)}  (restart proxy to load)")


if __name__ == "__main__":
    main()
