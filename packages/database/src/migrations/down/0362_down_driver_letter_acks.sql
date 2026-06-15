-- =============================================================================
-- Down-migration 0362 — drop the driver_letter_acks table.
--
-- Dev/staging only. Reverses 0362_driver_letter_acks.sql by dropping
-- `driver_letter_acks` (its RLS policies + indexes fall with the table).
-- DROP TABLE discards any captured driver-letter acknowledgements — no money /
-- licence / ledger records are touched (offline field-capture ack rows only).
-- On LIVE this re-opens the degraded leg of the offline-field-capture BLOCKER
-- (the /driver-letter-acks sink would lose its persistence target and fall back
-- to the audit-only degraded accept), so do not run against production.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS driver_letter_acks CASCADE;

COMMIT;
