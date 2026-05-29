-- Reverse migration 0126 — drop the field-workforce help_requests table.
-- Used by the migration test harness only; production rollbacks should
-- prefer forward migrations.

BEGIN;

DROP TABLE IF EXISTS help_requests;

COMMIT;
