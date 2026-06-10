-- =============================================================================
-- Down for 0335 — drop the operator-vs-customer `tenant_type` discriminator.
-- Idempotent: DROP INDEX/COLUMN IF EXISTS, guarded by a to_regclass check.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    DROP INDEX IF EXISTS tenants_tenant_type_idx;
    ALTER TABLE public.tenants DROP COLUMN IF EXISTS tenant_type;
  END IF;
END $$;

COMMIT;
