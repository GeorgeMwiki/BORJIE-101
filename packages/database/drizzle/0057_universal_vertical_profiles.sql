-- =============================================================================
-- Migration 0057 — Universal Vertical Profiles (Wave VP-1, Mr. Mwikila)
--
-- Spec: Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md
-- Founder lock: Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md
--
-- Creates the two canonical global tables for the vertical-profile registry:
--
--   1. vertical_profile_definitions — one row per (vertical, region) tuple.
--      PRIMARY KEY (id) where id = '{vertical}-{region}' (e.g. 'mining-tz',
--      'oilgas-no'). Carries entities, glossary, regulator bindings,
--      capability seeds, and a `status IN ('live', 'reserved', 'deprecated')`
--      lifecycle column.
--
--   2. vertical_workflows — one row per recurring obligation or opportunity
--      a profile tracks. FK to vertical_profile_definitions.id with
--      ON DELETE CASCADE. Workflows carry cadence, regulator binding,
--      due-date rule, grace + escalation windows, input/output contracts,
--      and provenance.
--
-- DESIGN NOTE — NO RLS.
-- These are global reference data, not tenant-scoped. Every tenant reads
-- the same catalogue; the per-tenant pin lives on `tenants.vertical_profile_id`
-- (soft FK added in §5 below). RLS would force pointless predicate evaluation
-- on every read. Write access is gated at the application layer (the seed
-- modules + the registry boot path are the only writers).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. vertical_profile_definitions — one row per (vertical, region) tuple
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vertical_profile_definitions (
  /** canonical profile id; equals '{vertical}-{region}' (e.g. 'mining-tz'). */
  id                    text PRIMARY KEY,

  /** top-level vertical category: 'mining' | 'agri' | 'oilgas' | 'fisheries'
      | 'forestry' | 'manufacturing' | 'tourism' | 'realestate' */
  vertical              text NOT NULL,

  /** ISO 3166-1 alpha-2 country code, optionally extended with a subdivision
      (e.g. 'tz', 'us-tx', 'us-ca', 'us-ny'). */
  region                text NOT NULL,

  /** Human-readable display name (e.g. 'Mining (Tanzania)'). */
  display_name          text NOT NULL,

  /** Lifecycle status:
        'live'       — implementation package shipped, tenants can pin here.
        'reserved'   — definition only, no implementation package yet.
        'deprecated' — historically supported, no longer accepting new tenants. */
  status                text NOT NULL,

  /** Long-form description of the profile's scope and exclusions. */
  description           text NOT NULL,

  /** JSONB array of entity definitions:
        [{ key, displayName, parentKey?, attributes: [{key, kind, required}] }]
      Mining-TZ ships ≥10 entities; reserved profiles ship ≥6. */
  entities              jsonb NOT NULL,

  /** JSONB array of {term, translations: {en, sw, ...}, definition, kind}. */
  glossary              jsonb NOT NULL,

  /** JSONB array of {regulatorId, filingKinds:[]}. Each regulatorId references
      regulator_definitions.id from migration 0055. */
  regulator_bindings    jsonb NOT NULL,

  /** JSONB array of capability ids to auto-mount for tenants pinned here. */
  capability_seeds      jsonb NOT NULL,

  /** JSONB array of provenance citations:
        [{ url, title, accessedAt: 'YYYY-MM-DD' }]
      Every claim about a regulator/workflow must trace to one of these. */
  provenance            jsonb NOT NULL,

  /** Optional pointer to the dedicated implementation package
      (e.g. '@borjie/vertical-profile-mining-tz'). NULL for reserved. */
  implementation_package text,

  /** When this row was inserted. */
  created_at            timestamptz NOT NULL DEFAULT NOW(),

  /** When this row was last updated. */
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Constraints
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_profile_definitions_status_chk'
  ) THEN
    ALTER TABLE vertical_profile_definitions
      ADD CONSTRAINT vertical_profile_definitions_status_chk
      CHECK (status IN ('live', 'reserved', 'deprecated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_profile_definitions_vertical_chk'
  ) THEN
    ALTER TABLE vertical_profile_definitions
      ADD CONSTRAINT vertical_profile_definitions_vertical_chk
      CHECK (vertical IN (
        'mining', 'agri', 'oilgas', 'fisheries',
        'forestry', 'manufacturing', 'tourism', 'realestate'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_profile_definitions_region_chk'
  ) THEN
    ALTER TABLE vertical_profile_definitions
      ADD CONSTRAINT vertical_profile_definitions_region_chk
      CHECK (length(region) BETWEEN 2 AND 8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_profile_definitions_vertical_region_uniq'
  ) THEN
    ALTER TABLE vertical_profile_definitions
      ADD CONSTRAINT vertical_profile_definitions_vertical_region_uniq
      UNIQUE (vertical, region);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_profile_definitions_impl_live_chk'
  ) THEN
    ALTER TABLE vertical_profile_definitions
      ADD CONSTRAINT vertical_profile_definitions_impl_live_chk
      CHECK (
        (status IN ('reserved', 'deprecated') AND implementation_package IS NULL)
        OR (status = 'live' AND implementation_package IS NOT NULL)
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vertical_profile_definitions_vertical
  ON vertical_profile_definitions (vertical);

CREATE INDEX IF NOT EXISTS idx_vertical_profile_definitions_region
  ON vertical_profile_definitions (region);

CREATE INDEX IF NOT EXISTS idx_vertical_profile_definitions_status
  ON vertical_profile_definitions (status);

-- NO RLS — global reference data. See header comment.

COMMENT ON TABLE vertical_profile_definitions IS
  'VP-1 — global registry of vertical profiles (live + reserved + deprecated). 75 rows at launch (1 live: mining-tz; 74 reserved across 8 verticals × 9-12 regions each). No RLS by design — global reference dataset. Spec: Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md.';

COMMENT ON COLUMN vertical_profile_definitions.id IS
  'Canonical profile id. Equals "{vertical}-{region}" — mining-tz, oilgas-no, realestate-ae. PRIMARY KEY.';

COMMENT ON COLUMN vertical_profile_definitions.status IS
  'live = implementation package shipped; reserved = definition only; deprecated = no longer accepting new tenants.';

COMMENT ON COLUMN vertical_profile_definitions.regulator_bindings IS
  'JSONB array of {regulatorId, filingKinds:[]}. Each regulatorId joins to regulator_definitions.id from migration 0055.';

COMMENT ON COLUMN vertical_profile_definitions.implementation_package IS
  'NPM package name (e.g. @borjie/vertical-profile-mining-tz) for live profiles. NULL for reserved + deprecated.';

-- -----------------------------------------------------------------------------
-- 2. vertical_workflows — one row per recurring obligation/opportunity
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vertical_workflows (
  /** canonical workflow id; equals '{profile-id}.{slug}' (e.g. 'mining-tz.tra-vat-monthly'). */
  id                    text PRIMARY KEY,

  /** FK into vertical_profile_definitions.id. */
  profile_id            text NOT NULL
                        REFERENCES vertical_profile_definitions(id) ON DELETE CASCADE,

  /** Human-readable workflow name. */
  name                  text NOT NULL,

  /** Cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'event'. */
  cadence               text NOT NULL,

  /** JSONB array of {regulatorId, filingKind}. */
  regulator_binding     jsonb NOT NULL,

  /** Due-date rule DSL string (e.g. 'last-day-of-month + 15d'). */
  due_date_rule         text NOT NULL,

  /** Hours before due-date that Mwikila starts gentle nudges. 0-8760. */
  grace_period_hours    integer NOT NULL,

  /** Hours after due-date for hard escalation to designated officer. 0-8760. */
  escalation_hours      integer NOT NULL,

  /** JSONB encoding of the zod input schema (kept as JSON-Schema-shaped value). */
  input_contract        jsonb NOT NULL,

  /** JSONB encoding of the output / rendered filing contract. */
  output_contract       jsonb NOT NULL,

  /** JSONB array of provenance citations [{url, title, accessedAt}]. */
  provenance            jsonb NOT NULL,

  /** When this row was inserted. */
  created_at            timestamptz NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Constraints
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_workflows_cadence_chk'
  ) THEN
    ALTER TABLE vertical_workflows
      ADD CONSTRAINT vertical_workflows_cadence_chk
      CHECK (cadence IN (
        'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'event'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_workflows_grace_chk'
  ) THEN
    ALTER TABLE vertical_workflows
      ADD CONSTRAINT vertical_workflows_grace_chk
      CHECK (grace_period_hours BETWEEN 0 AND 8760);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vertical_workflows_escalation_chk'
  ) THEN
    ALTER TABLE vertical_workflows
      ADD CONSTRAINT vertical_workflows_escalation_chk
      CHECK (escalation_hours BETWEEN 0 AND 8760);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vertical_workflows_profile
  ON vertical_workflows (profile_id);

CREATE INDEX IF NOT EXISTS idx_vertical_workflows_cadence
  ON vertical_workflows (profile_id, cadence);

-- NO RLS — global reference data.

COMMENT ON TABLE vertical_workflows IS
  'VP-1 — global registry of vertical-profile workflows (recurring obligations / opportunities). Joined to vertical_profile_definitions via profile_id. No RLS by design. Spec: Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md §2 Part 2.';

COMMENT ON COLUMN vertical_workflows.id IS
  'Canonical workflow id. Equals "{profile-id}.{slug}" — mining-tz.tra-vat-monthly, mining-tz.tumemadini-annual-royalty. PRIMARY KEY.';

COMMENT ON COLUMN vertical_workflows.due_date_rule IS
  'Due-date DSL: relative expressions like "last-day-of-month + 15d", "fiscal-year-end + 31d", "trigger-event + 90d".';

-- -----------------------------------------------------------------------------
-- 3. tenants.vertical_profile_id — soft FK so tenants pin to a profile
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name = 'vertical_profile_id'
  ) THEN
    ALTER TABLE tenants
      ADD COLUMN vertical_profile_id text NULL
      REFERENCES vertical_profile_definitions(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_tenants_vertical_profile
      ON tenants (vertical_profile_id);
    COMMENT ON COLUMN tenants.vertical_profile_id IS
      'VP-1 — FK into vertical_profile_definitions. Nullable for back-compat. Launch (mining-tz) tenant backfilled by the seed package, not this migration.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. updated_at trigger for vertical_profile_definitions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vertical_profiles_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_vertical_profile_definitions_touch'
  ) THEN
    CREATE TRIGGER trg_vertical_profile_definitions_touch
      BEFORE UPDATE ON vertical_profile_definitions
      FOR EACH ROW EXECUTE FUNCTION vertical_profiles_touch_updated_at();
  END IF;
END $$;

COMMIT;
