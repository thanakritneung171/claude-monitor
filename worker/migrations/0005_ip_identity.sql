-- Step 2 of IDENTITY-LAYERS-PLAN: per-IP audit field + centralized identity table

-- L4: client_ip audit on every api_logs row
ALTER TABLE api_logs ADD COLUMN client_ip TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_api_logs_client_ip
  ON api_logs(client_ip)
  WHERE client_ip != '';

-- L3: centralized IP → email mapping
-- No TTL — entries live forever, overwritten by sniff/JWT capture on the same IP
CREATE TABLE IF NOT EXISTS ip_identity (
  ip          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT DEFAULT '',
  uuid        TEXT DEFAULT '',
  updated_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_identity_email
  ON ip_identity(email);
