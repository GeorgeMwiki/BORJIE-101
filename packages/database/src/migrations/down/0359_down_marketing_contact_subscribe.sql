-- =============================================================================
-- Down-migration 0359 — drop the marketing contact + subscribe tables (KI-013).
--
-- Dev/staging only. Reverses 0359_marketing_contact_subscribe.sql by dropping
-- `marketing_contact_submissions` and `marketing_subscriptions` (their RLS
-- policies + indexes fall with the tables). DROP TABLE discards any captured
-- inbound contact inquiries and blog subscribers — no money / licence / ledger
-- records are touched. On LIVE this re-opens the KI-013 404 (the gateway
-- /contact + /subscribe handlers would lose their persistence target and fall
-- back to log-only), so do not run against production.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS marketing_contact_submissions;
DROP TABLE IF EXISTS marketing_subscriptions;

COMMIT;
