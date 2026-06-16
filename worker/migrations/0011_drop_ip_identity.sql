-- Stop using IP as identity (VPN changes IP → false attribution).
-- Remove the live L3 "borrow email by IP" table. Identity is now keyed by email
-- (email_identity) only; the proxy attaches email from each prompt's own token
-- (JWT for /v1/messages, session cookie for claude.ai chat).
--
-- Kept on purpose:
--   • ip_identity_backup — frozen historical snapshot, powers the /identity page
--   • api_logs.client_ip / machine_name — recorded as audit only, never identity
--
-- Apply: wrangler d1 execute prompt-logger --remote --command "DROP TABLE IF EXISTS ip_identity;"

DROP TABLE IF EXISTS ip_identity;
