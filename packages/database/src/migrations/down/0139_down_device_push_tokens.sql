-- Reverse migration 0139 — drop device_push_tokens.
-- Used by the migration test harness only; production rollbacks should
-- prefer forward migrations.

BEGIN;

DROP TABLE IF EXISTS device_push_tokens CASCADE;

COMMIT;
