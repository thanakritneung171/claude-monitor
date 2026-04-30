# Copy this file to config.py and fill in real values.
# config.py is gitignored — never commit real keys.

# Deployed Cloudflare Worker URL (from: npm run deploy)
WORKER_URL = "https://claude-monitor-hooks.<yourname>.workers.dev"

# Must match: wrangler secret put API_KEY
API_KEY = "your-secret-key-here"

# Your Claude account email (identifies who owns this log entry)
ACCOUNT_EMAIL = "you@example.com"

# mitmproxy listen port
PROXY_PORT = 8080
