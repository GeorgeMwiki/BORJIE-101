-- =============================================================================
-- Down-migration 0348 — drop notification_dispatch_log.
--
-- Dev/staging only — DATA LOSS. Drops the per-recipient delivery ledger
-- created by 0348 (table + indexes + RLS policies fall with it). Only for a
-- clean apply→reverse test on a throwaway DB; never run against an environment
-- with real dispatch history.
--
-- NOTE: on LIVE the table predates this migration (schema-ahead drift), so a
-- real prod rollback would re-open the same drift 0348 closed — do not run.
--
-- Reverses migration 0348_notification_dispatch_log.sql.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS notification_dispatch_log CASCADE;

COMMIT;
