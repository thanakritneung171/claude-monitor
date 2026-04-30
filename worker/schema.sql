CREATE TABLE IF NOT EXISTS api_logs (
  id                    TEXT    PRIMARY KEY,
  ts                    INTEGER NOT NULL,
  client                TEXT    NOT NULL DEFAULT 'unknown',
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
  cost_usd              REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_api_logs_ts      ON api_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_model   ON api_logs(model);
CREATE INDEX IF NOT EXISTS idx_api_logs_client  ON api_logs(client);
CREATE INDEX IF NOT EXISTS idx_api_logs_machine ON api_logs(machine_name);
