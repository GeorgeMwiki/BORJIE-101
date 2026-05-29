-- =============================================================================
-- Migration 0144 — Multi-region regulatory zone library (WS-8).
--
-- Companion to:
--   - packages/database/src/migrations/0130_postgis.sql (regulatory_zones)
--   - packages/database/src/migrations/0143_regulator_jurisdictions.sql
--   - packages/database/src/schemas/regulatory-zones.schema.ts (extended below)
--   - services/api-gateway/src/services/geofencing/regulatory.ts
--
-- Issue #207 — World-scale tenant config.
--   The existing `regulatory_zones` table (migration 0130) tracks
--   tenant-AGNOSTIC TZ-set boundaries (PCCB / NEMC / EITI). For the
--   world-scale rollout the same model extends naturally — regulators
--   publish polygons; every operator inherits them — but the lookup
--   needs to be jurisdiction-aware so a CL tenant sees SERNAGEOMIN
--   polygons and not Tanzania mining-corridor lines.
--
--   This migration:
--     1. Adds `regulator_set` to `regulatory_zones` so the geofencing
--        watcher can scope polygon lookups by jurisdiction.
--     2. Adds `country_code` so cross-border tenants can query their
--        operating jurisdictions.
--     3. Backfills both columns: every existing row gets
--        regulator_set='TZ-set', country_code='TZ' (consistent with
--        the 0130 seed which is Tanzania-only).
--     4. Widens the existing UNIQUE INDEX to include `regulator_set`
--        so the same authority slug can recur per jurisdiction
--        (`pccb` -> TZ, future Australian `epa-vic-au` -> AU, etc.).
--
-- Tenant scope:
--   `regulatory_zones` stays tenant-AGNOSTIC. No RLS — same model as
--   the parent table and `regulator_jurisdictions`.
--
-- Hard rules:
--   * Idempotent. Forward-only. Append-only. NEVER edited after merge.
--   * NO breaking changes — every existing row keeps the same identity
--     via the (authority, code) values; the new regulator_set column
--     is backfilled to 'TZ-set' before the constraint widens.
-- =============================================================================

BEGIN;

-- ─── §1. Add regulator_set column ────────────────────────────────────────────
ALTER TABLE regulatory_zones
  ADD COLUMN IF NOT EXISTS regulator_set text NOT NULL DEFAULT 'TZ-set';

-- ─── §2. Add country_code column ─────────────────────────────────────────────
ALTER TABLE regulatory_zones
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'TZ';

-- ─── §3. Constraints ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulatory_zones_regulator_set_chk'
  ) THEN
    ALTER TABLE regulatory_zones
      ADD CONSTRAINT regulatory_zones_regulator_set_chk
      CHECK (regulator_set IN (
        'TZ-set', 'KE-set', 'UG-set', 'NG-set', 'ZA-set',
        'AU-set', 'CL-set', 'ID-set', 'generic'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulatory_zones_country_code_chk'
  ) THEN
    ALTER TABLE regulatory_zones
      ADD CONSTRAINT regulatory_zones_country_code_chk
      CHECK (char_length(country_code) = 2);
  END IF;
END $$;

-- ─── §4. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS regulatory_zones_regulator_set_idx
  ON regulatory_zones (regulator_set);

CREATE INDEX IF NOT EXISTS regulatory_zones_country_code_idx
  ON regulatory_zones (country_code);

-- ─── §5. Widen UNIQUE INDEX so authority+code is unique PER regulator_set ────
-- The 0130 UNIQUE INDEX on (authority, code) becomes too narrow when more than
-- one jurisdiction shares an authority slug shape. We add a wider UNIQUE INDEX
-- and DROP the older one inside the same transaction.
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

  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'regulatory_zones_authority_code_unique'
  ) THEN
    DROP INDEX regulatory_zones_authority_code_unique;
  END IF;
END $$;

COMMIT;
