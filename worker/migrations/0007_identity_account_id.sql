-- Add account_id and org_id to ip_identity for stable identity anchors.
-- account_id = user.account_id from Claude Code metrics (e.g. user_01MKcLNqJ43YPpDjmwtQBpJL)
-- org_id     = organization.id UUID from metrics

ALTER TABLE ip_identity ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ip_identity ADD COLUMN org_id     TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ip_identity_account_id
  ON ip_identity(account_id) WHERE account_id != '';
