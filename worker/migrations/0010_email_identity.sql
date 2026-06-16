-- Canonical identity record keyed by EMAIL (VPN-safe — survives IP changes).
-- account_id / anon_id / device info are attributes; ips & client_types are
-- comma-separated lists aggregated across all of a person's devices/networks.
-- ip_identity (ip-keyed) stays as the L3 fallback routing table.

CREATE TABLE IF NOT EXISTS email_identity (
  email        TEXT PRIMARY KEY,
  name         TEXT    NOT NULL DEFAULT '',
  account_id   TEXT    NOT NULL DEFAULT '',
  uuid         TEXT    NOT NULL DEFAULT '',
  org_id       TEXT    NOT NULL DEFAULT '',
  anon_id      TEXT    NOT NULL DEFAULT '',
  os_type      TEXT    NOT NULL DEFAULT '',
  os_version   TEXT    NOT NULL DEFAULT '',
  host_arch    TEXT    NOT NULL DEFAULT '',
  app_version  TEXT    NOT NULL DEFAULT '',
  terminal     TEXT    NOT NULL DEFAULT '',
  ips          TEXT    NOT NULL DEFAULT '',
  client_types TEXT    NOT NULL DEFAULT '',
  first_seen   INTEGER NOT NULL DEFAULT 0,
  updated_ms   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_identity_account_id ON email_identity(account_id) WHERE account_id != '';
CREATE INDEX IF NOT EXISTS idx_email_identity_anon_id    ON email_identity(anon_id)     WHERE anon_id    != '';

-- Seed from existing ip_identity so the page isn't empty before live traffic refills.
INSERT INTO email_identity
  (email, name, account_id, uuid, org_id, anon_id, ips, first_seen, updated_ms)
SELECT email,
       COALESCE(MAX(NULLIF(name,       '')), ''),
       COALESCE(MAX(NULLIF(account_id, '')), ''),
       COALESCE(MAX(NULLIF(uuid,       '')), ''),
       COALESCE(MAX(NULLIF(org_id,     '')), ''),
       COALESCE(MAX(NULLIF(anon_id,    '')), ''),
       GROUP_CONCAT(DISTINCT ip),
       MIN(updated_ms),
       MAX(updated_ms)
FROM ip_identity
WHERE email != ''
GROUP BY email
ON CONFLICT(email) DO NOTHING;
