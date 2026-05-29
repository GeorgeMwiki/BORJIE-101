-- =============================================================================
-- Down-migration for 0149_lock_tenant_jurisdiction.sql.
--
-- Reverses the tenants.jurisdiction_locked_at +
-- tenants.jurisdiction_locked_by_user_id columns and their
-- foreign-key constraint.
--
-- DESTRUCTIVE: drops the lock metadata. Dev/staging ONLY — production
--    tenants rely on this column to enforce the JC-6 self-change refusal.
-- =============================================================================

BEGIN;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_jurisdiction_locked_by_fk;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS jurisdiction_locked_at,
  DROP COLUMN IF EXISTS jurisdiction_locked_by_user_id;

COMMIT;
