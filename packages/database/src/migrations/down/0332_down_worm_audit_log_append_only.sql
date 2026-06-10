-- =============================================================================
-- DOWN 0332 — remove the worm_audit_log append-only triggers + functions.
-- Idempotent: DROP TRIGGER/FUNCTION IF EXISTS. DEV/STAGING ONLY — running this
-- in production re-opens the WORM chain to silent rewrites.
-- =============================================================================

BEGIN;

DROP TRIGGER  IF EXISTS worm_audit_log_no_update   ON worm_audit_log;
DROP TRIGGER  IF EXISTS worm_audit_log_no_delete   ON worm_audit_log;
DROP TRIGGER  IF EXISTS worm_audit_log_no_truncate ON worm_audit_log;
DROP FUNCTION IF EXISTS worm_audit_log_block_mutation();
DROP FUNCTION IF EXISTS worm_audit_log_block_truncate();

COMMIT;
