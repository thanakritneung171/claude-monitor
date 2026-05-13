-- Auth tables (users, sessions) + key/value app_settings
-- Apply with:   wrangler d1 execute prompt-logger --remote --file=migrations/0002_auth.sql
-- For local:    wrangler d1 execute prompt-logger --local  --file=migrations/0002_auth.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'viewer',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  status        TEXT    NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─── Initial admin user ───────────────────────────────────────────────────────
-- Generate a PBKDF2 hash with the helper script in scripts/hash-password.mjs:
--   node scripts/hash-password.mjs "your-password-here"
-- Then paste the printed hash below and uncomment the INSERT.
--
-- INSERT OR IGNORE INTO users (id, email, password_hash, role, created_at, status)
-- VALUES (
--   'admin-0001',
--   'admin@example.com',
--   'pbkdf2$100000$<salt-hex>$<hash-hex>',
--   'admin',
--   strftime('%s', 'now') * 1000,
--   'active'
-- );
