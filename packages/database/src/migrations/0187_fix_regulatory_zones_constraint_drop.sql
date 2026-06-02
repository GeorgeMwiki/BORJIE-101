-- =============================================================================
-- Migration 0187 — Fix regulatory_zones unique-constraint drop
--
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
--
-- WHY THIS EXISTS (INT-7 / migration-apply-check failure #6):
--
--   Migration 0144_tenant_regulatory_zones.sql (line 103) attempts:
--
--       DROP INDEX regulatory_zones_authority_code_unique;
--
--   However, that index was created in 0130_postgis.sql as a TABLE CONSTRAINT:
--
--       CONSTRAINT regulatory_zones_authority_code_unique UNIQUE (authority, code)
--
--   Postgres refuses to DROP an index that backs a constraint via the
--   `DROP INDEX` command; you must instead use:
--
--       ALTER TABLE regulatory_zones
--         DROP CONSTRAINT regulatory_zones_authority_code_unique;
--
--   0144 is immutable (already shipped). This fixup performs the correct
--   constraint drop, idempotently. On a fresh DB where 0144 already failed
--   (the whole transaction rolled back) this migration does the full drop +
--   ensures the wider replacement index from 0144 exists. On production where
--   0144 may have run partially, this is safe because:
--     * DROP CONSTRAINT IF EXISTS is a no-op when the constraint is gone.
--     * CREATE UNIQUE INDEX IF NOT EXISTS is a no-op when the index exists.
--
-- IDEMPOTENT: all DDL guarded with DO blocks + IF EXISTS / IF NOT EXISTS.
-- =============================================================================

BEGIN;

-- ─── §0. Add the columns 0144 intended (regulator_set, country_code).
-- 0144 added these (NOT NULL DEFAULT) but its whole transaction rolled back on a
-- fresh DB due to its DROP INDEX failure, so the §2 wider index below would have
-- no `regulator_set` column to reference. Add them idempotently first (these
-- carry defaults, so they are safe non-blocking backfills).
ALTER TABLE regulatory_zones
  ADD COLUMN IF NOT EXISTS regulator_set text NOT NULL DEFAULT 'TZ-set';
ALTER TABLE regulatory_zones
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'TZ';

-- ─── §1. Drop the old narrower constraint (authority, code) if it still exists.
-- On a fresh DB where 0144 rolled back, this constraint was created by 0130.
-- On production where 0144 partial-succeeded (unlikely but possible), it may
-- already be gone. Guard both cases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname   = 'regulatory_zones_authority_code_unique'
       AND conrelid  = 'regulatory_zones'::regclass
  ) THEN
    ALTER TABLE regulatory_zones
      DROP CONSTRAINT regulatory_zones_authority_code_unique;
  END IF;
END $$;

-- ─── §2. Ensure the wider replacement index from 0144 exists.
-- 0144 created this inside a DO block that also attempted the DROP INDEX
-- (which failed). If 0144 rolled back in full, this index does not exist
-- yet on a fresh DB — create it now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'regulatory_zones_set_authority_code_unique'
  ) THEN
    CREATE UNIQUE INDEX regulatory_zones_set_authority_code_unique
      ON regulatory_zones (regulator_set, authority, code);
  END IF;
END $$;

COMMIT;
