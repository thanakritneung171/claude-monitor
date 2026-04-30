-- Add account_email column to existing api_logs table
ALTER TABLE api_logs ADD COLUMN account_email TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_api_logs_email ON api_logs(account_email);
