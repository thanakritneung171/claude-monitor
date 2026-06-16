-- Snapshot ip_identity BEFORE adding new columns (static backup)
CREATE TABLE IF NOT EXISTS ip_identity_backup AS SELECT * FROM ip_identity;

-- Add device/env + timeline + client tracking fields to live ip_identity
ALTER TABLE ip_identity ADD COLUMN os_type      TEXT NOT NULL DEFAULT '';
ALTER TABLE ip_identity ADD COLUMN os_version   TEXT NOT NULL DEFAULT '';
ALTER TABLE ip_identity ADD COLUMN host_arch    TEXT NOT NULL DEFAULT '';
ALTER TABLE ip_identity ADD COLUMN app_version  TEXT NOT NULL DEFAULT '';
ALTER TABLE ip_identity ADD COLUMN terminal     TEXT NOT NULL DEFAULT '';
ALTER TABLE ip_identity ADD COLUMN first_seen   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ip_identity ADD COLUMN client_types TEXT NOT NULL DEFAULT '';
