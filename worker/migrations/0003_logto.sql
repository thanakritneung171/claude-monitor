-- Switch to Logto OIDC: drop local users + recreate sessions for Logto identity.
-- Apply with:   wrangler d1 execute prompt-logger --remote --file=migrations/0003_logto.sql
-- For local:    wrangler d1 execute prompt-logger --local  --file=migrations/0003_logto.sql

DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sessions;

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  sub        TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE oauth_state (
  state         TEXT    PRIMARY KEY,
  code_verifier TEXT    NOT NULL,
  next_path     TEXT    NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_exp ON oauth_state(expires_at);
