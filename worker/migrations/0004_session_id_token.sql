-- Store Logto id_token alongside the session so /logout can call Logto end-session
-- with id_token_hint (RP-initiated logout).
-- Apply with:   wrangler d1 execute prompt-logger --remote --file=migrations/0004_session_id_token.sql

ALTER TABLE sessions ADD COLUMN id_token TEXT;
