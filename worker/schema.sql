CREATE TABLE IF NOT EXISTS api_logs (
  id                    TEXT    PRIMARY KEY,
  ts                    INTEGER NOT NULL,
  client                TEXT    NOT NULL DEFAULT 'unknown',
  account_email         TEXT    NOT NULL DEFAULT '',
  machine_name          TEXT    NOT NULL DEFAULT '',
  model                 TEXT    NOT NULL DEFAULT '',
  prompt                TEXT    NOT NULL DEFAULT '',
  prompt_chars          INTEGER NOT NULL DEFAULT 0,
  response_chars        INTEGER NOT NULL DEFAULT 0,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  total_tokens          INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0,
  client_ip             TEXT    NOT NULL DEFAULT '',
  app_version           TEXT    NOT NULL DEFAULT '',
  os_type               TEXT    NOT NULL DEFAULT '',
  os_version            TEXT    NOT NULL DEFAULT '',
  host_arch             TEXT    NOT NULL DEFAULT '',
  terminal              TEXT    NOT NULL DEFAULT '',
  device_id             TEXT    NOT NULL DEFAULT '',
  mac_address           TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_api_logs_ts      ON api_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_model   ON api_logs(model);
CREATE INDEX IF NOT EXISTS idx_api_logs_client  ON api_logs(client);
CREATE INDEX IF NOT EXISTS idx_api_logs_machine ON api_logs(machine_name);
CREATE INDEX IF NOT EXISTS idx_api_logs_email   ON api_logs(account_email);

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
