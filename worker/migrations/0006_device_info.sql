-- Add device/environment fields from claude_code/metrics POST + bridge WebSocket.
-- Apply: wrangler d1 execute prompt-logger --remote --file=migrations/0006_device_info.sql
-- Local: wrangler d1 execute prompt-logger --local  --file=migrations/0006_device_info.sql

ALTER TABLE api_logs ADD COLUMN app_version TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs ADD COLUMN os_type     TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs ADD COLUMN os_version  TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs ADD COLUMN host_arch   TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs ADD COLUMN terminal    TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs ADD COLUMN device_id   TEXT NOT NULL DEFAULT '';
ALTER TABLE api_logs ADD COLUMN mac_address TEXT NOT NULL DEFAULT '';
