-- =============================================================================
-- 0113: Drop `country` DB-level defaults — onboarding must pick country
-- =============================================================================
-- Blueprint cite: Docs/PHASES_FINDINGS/phM-platform-blueprint.md §A.1 / A1
--
-- Two tables still carry `country TEXT DEFAULT 'KE'`:
--   - `properties` (migration 0001:262 + schema property.schema.ts:96)
--   - `tenants`    (migration 0001:63 — already dropped in 0036, retained here
--                    as a safety re-run in case the environment skipped 0036)
--
-- Dropping the default turns silent "tenant rows without country → Kenya"
-- bugs into loud NOT-NULL insert failures, forcing callers to explicitly
-- pass the country resolved from the compliance-plugin registry.
--
-- This migration is purely schema-level (ALTER ... DROP DEFAULT). It never
-- mutates an existing row's country. Existing rows retain whatever value
-- they already have — no data loss.
-- =============================================================================

-- properties.country — drop legacy 'KE' default
ALTER TABLE properties
  ALTER COLUMN country DROP DEFAULT;

-- tenants.country — already dropped by 0036 in most envs; idempotent re-run
-- for any environment that skipped or rolled back 0036.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tenants'
      AND column_name = 'country'
      AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE tenants
      ALTER COLUMN country DROP DEFAULT;
  END IF;
END $$;
