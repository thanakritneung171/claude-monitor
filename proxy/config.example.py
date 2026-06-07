# Copy this file to config.py and fill in real values.
# config.py is gitignored — never commit real keys.

# Deployed Cloudflare Worker URL (from: npm run deploy)
WORKER_URL = "https://claude-monitor-hooks.<yourname>.workers.dev"

# Must match: wrangler secret put API_KEY
API_KEY = "your-secret-key-here"

# mitmproxy listen port
PROXY_PORT = 8080

# Email filter — when ON, only log calls whose account_email contains the
# substring (case-insensitive). Set EMAIL_FILTER_ENABLED = False to log all.
import os
EMAIL_FILTER_ENABLED   = os.getenv("EMAIL_FILTER_ENABLED", "true").lower() == "true"
EMAIL_FILTER_SUBSTRING = os.getenv("EMAIL_FILTER_SUBSTRING", "@softdebut")
