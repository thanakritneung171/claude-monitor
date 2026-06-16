-- Add anon_id (Segment anonymousId) to ip_identity and api_logs.
-- anonymousId = browser-localStorage stable ID from claude.ai Desktop/web
-- format: claudeai.v1.{UUID} — stable across VPN/IP changes per installation

ALTER TABLE ip_identity ADD COLUMN anon_id TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs    ADD COLUMN anon_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ip_identity_anon_id
  ON ip_identity(anon_id) WHERE anon_id != '';
