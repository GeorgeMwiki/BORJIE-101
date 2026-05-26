-- =============================================================================
-- Migration 0055 — Universal Jurisdiction Profiles + Compliance Frameworks
--                   (Wave UNIV-1, Mr. Mwikila)
--
-- Spec: Docs/DESIGN/UNIVERSAL_JURISDICTION_SPEC.md
-- Lock: Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md
--
-- Creates the four canonical universal-from-day-one tables that turn every
-- country/region rule (currency, phone, regulator, breach deadline, RTBF
-- cascade, working week, quiet hours, language packs, vertical profiles,
-- timezone) into pluggable rows rather than hardcoded core code:
--
--   1. jurisdiction_profiles     — one row per country / subdivision
--                                  (`tz`, `gb-eng`, `us-ca`, …). PK is
--                                  the human-readable short-code; the
--                                  rest of the platform looks up by
--                                  this code.
--   2. compliance_frameworks     — one row per named law (`gdpr`,
--                                  `tz_dpa_2022`, `ccpa`, `lgpd`, …).
--                                  Article registry stored as JSONB.
--   3. framework_control_mappings — join from a framework article to
--                                  the Borjie package + impl pointer
--                                  that satisfies it. UNIQUE
--                                  (framework_id, article_ref, package_name).
--   4. regulator_definitions      — per-jurisdiction regulator catalogue
--                                  (`tz-tra`, `tz-tumemadini`, `tz-nemc`,
--                                  `tz-bot`, `gb-ico`, …). FK to
--                                  jurisdiction_profiles.id.
--
-- INVARIANT — these four tables are **global reference data**. Every tenant
-- reads from them, no tenant writes to them at runtime. RLS is intentionally
-- DISABLED (see §9 of UNIVERSAL_JURISDICTION_SPEC.md). The seed data is NOT
-- baked into this migration; the `@borjie/jurisdiction-profiles` +
-- `@borjie/jurisdiction-profile-tz` packages own the seed and install it
-- through `db:seed`. This migration only creates the empty tables.
--
-- Adds a soft FK column `tenants.jurisdiction_profile_id` (nullable for
-- backwards compatibility — existing TZ-launch tenants get the value
-- backfilled by the seed package). The FK is declared but `ON DELETE
-- RESTRICT` is intentionally `ON DELETE SET NULL` because a profile may be
-- temporarily retired during a legal-text re-audit.
--
-- Idempotent (IF NOT EXISTS + guarded DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. jurisdiction_profiles — one row per country / subdivision
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jurisdiction_profiles (
  id                        text PRIMARY KEY,
  iso_country               text NOT NULL,
  iso_subdivision           text,
  display_name              text NOT NULL,
  data_protection_laws      text[] NOT NULL DEFAULT '{}',
  data_residency_kind       text NOT NULL,
  regional_bloc             text,
  breach_deadline_hours     int NOT NULL,
  rtbf_cascade_scope        text NOT NULL,
  currency_code             text NOT NULL,
  phone_e164_cc             text NOT NULL,
  phone_e164_pattern        text NOT NULL,
  address_format            jsonb NOT NULL,
  holiday_calendar_key      text NOT NULL,
  working_week              int[] NOT NULL,
  timezone_default          text NOT NULL,
  quiet_hours_default       jsonb NOT NULL,
  tax_matrix                jsonb NOT NULL DEFAULT '{}'::jsonb,
  language_pack_codes       text[] NOT NULL DEFAULT '{}',
  vertical_profile_codes    text[] NOT NULL DEFAULT '{}',
  profile_source_url        text NOT NULL,
  profile_source_title      text NOT NULL,
  profile_source_date       date NOT NULL,
  audit_hash                text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jurisdiction_profiles_residency_chk'
  ) THEN
    ALTER TABLE jurisdiction_profiles
      ADD CONSTRAINT jurisdiction_profiles_residency_chk
      CHECK (data_residency_kind IN ('strict-in-country', 'regional-bloc', 'unrestricted'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jurisdiction_profiles_iso_country_len_chk'
  ) THEN
    ALTER TABLE jurisdiction_profiles
      ADD CONSTRAINT jurisdiction_profiles_iso_country_len_chk
      CHECK (char_length(iso_country) = 2);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jurisdiction_profiles_iso_country
  ON jurisdiction_profiles (iso_country);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_profiles_residency
  ON jurisdiction_profiles (data_residency_kind);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_profiles_dp_laws
  ON jurisdiction_profiles USING GIN (data_protection_laws);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_profiles_language_packs
  ON jurisdiction_profiles USING GIN (language_pack_codes);

-- NO RLS — `jurisdiction_profiles` is global reference data shared by every
-- tenant. Disabling RLS is intentional (see §9 of the spec). Tenant-scoped
-- columns intentionally absent.

COMMENT ON TABLE jurisdiction_profiles IS
  'UNIV-1 — global reference data. One row per country/subdivision (PK = short-code, e.g. ''tz'', ''gb-eng'', ''us-ca''). NO RLS — every tenant reads, only seed packages write at bootstrap.';

-- -----------------------------------------------------------------------------
-- 2. compliance_frameworks — one row per named law
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance_frameworks (
  id                   text PRIMARY KEY,
  display_name         text NOT NULL,
  jurisdictions        text[] NOT NULL DEFAULT '{}',
  effective_date       date NOT NULL,
  article_registry     jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url           text NOT NULL,
  source_title         text NOT NULL,
  source_date          date NOT NULL,
  audit_hash           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_frameworks_jurisdictions
  ON compliance_frameworks USING GIN (jurisdictions);

-- NO RLS — `compliance_frameworks` is global reference data.

COMMENT ON TABLE compliance_frameworks IS
  'UNIV-1 — global reference data. One row per named compliance regulation (gdpr, tz_dpa_2022, ccpa, lgpd, pipl, …). `article_registry` jsonb encodes the per-article topic map. NO RLS.';

-- -----------------------------------------------------------------------------
-- 3. framework_control_mappings — article → package implementation pointer
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS framework_control_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id    text NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,
  article_ref     text NOT NULL,
  control_kind    text NOT NULL,
  package_name    text NOT NULL,
  impl_pointer    text NOT NULL,
  audit_hash      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'framework_control_mappings_unique_triple'
  ) THEN
    ALTER TABLE framework_control_mappings
      ADD CONSTRAINT framework_control_mappings_unique_triple
      UNIQUE (framework_id, article_ref, package_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'framework_control_mappings_kind_chk'
  ) THEN
    ALTER TABLE framework_control_mappings
      ADD CONSTRAINT framework_control_mappings_kind_chk
      CHECK (control_kind IN (
        'breach-notification', 'rtbf', 'consent', 'data-residency', 'dpia',
        'data-minimisation', 'encryption-at-rest', 'encryption-in-transit',
        'access-log', 'audit-trail', 'cross-border-transfer', 'data-subject-rights',
        'retention', 'security-safeguards', 'sensitive-data-handling', 'breach-record'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_framework_control_mappings_framework
  ON framework_control_mappings (framework_id);

CREATE INDEX IF NOT EXISTS idx_framework_control_mappings_kind
  ON framework_control_mappings (control_kind);

CREATE INDEX IF NOT EXISTS idx_framework_control_mappings_package
  ON framework_control_mappings (package_name);

-- NO RLS — global reference data.

COMMENT ON TABLE framework_control_mappings IS
  'UNIV-1 — global reference data. Join from a compliance framework article to the Borjie package + impl pointer that satisfies it. UNIQUE (framework_id, article_ref, package_name). NO RLS.';

-- -----------------------------------------------------------------------------
-- 4. regulator_definitions — per-jurisdiction regulator catalogue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regulator_definitions (
  id                text PRIMARY KEY,
  jurisdiction_id   text NOT NULL REFERENCES jurisdiction_profiles(id) ON DELETE CASCADE,
  display_name      text NOT NULL,
  domain            text NOT NULL,
  filing_kinds      jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_pattern       jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_endpoint      text,
  audit_hash        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'regulator_definitions_domain_chk'
  ) THEN
    ALTER TABLE regulator_definitions
      ADD CONSTRAINT regulator_definitions_domain_chk
      CHECK (domain IN (
        'tax', 'mining', 'environment', 'central-bank', 'data-protection',
        'customs', 'securities', 'labour', 'health', 'telecommunications',
        'energy', 'financial-services', 'competition'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_regulator_definitions_jurisdiction
  ON regulator_definitions (jurisdiction_id);

CREATE INDEX IF NOT EXISTS idx_regulator_definitions_domain
  ON regulator_definitions (jurisdiction_id, domain);

-- NO RLS — global reference data.

COMMENT ON TABLE regulator_definitions IS
  'UNIV-1 — global reference data. Per-jurisdiction regulators (tz-tra, tz-tumemadini, tz-nemc, tz-bot, …). `filing_kinds` jsonb array describes cadence + due day + penalty. NO RLS.';

-- -----------------------------------------------------------------------------
-- 5. tenants.jurisdiction_profile_id — soft FK so tenants pin to a profile
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
      AND column_name = 'jurisdiction_profile_id'
  ) THEN
    ALTER TABLE tenants
      ADD COLUMN jurisdiction_profile_id text NULL
      REFERENCES jurisdiction_profiles(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_tenants_jurisdiction_profile
      ON tenants (jurisdiction_profile_id);
    COMMENT ON COLUMN tenants.jurisdiction_profile_id IS
      'UNIV-1 — FK into jurisdiction_profiles. Nullable for back-compat. The launch (TZ) tenant is backfilled by the seed package, not this migration.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. updated_at trigger for jurisdiction_profiles / compliance_frameworks /
--    regulator_definitions (so audit re-runs the citation snapshot)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION universal_juris_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_jurisdiction_profiles_touch'
  ) THEN
    CREATE TRIGGER trg_jurisdiction_profiles_touch
      BEFORE UPDATE ON jurisdiction_profiles
      FOR EACH ROW EXECUTE FUNCTION universal_juris_touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_compliance_frameworks_touch'
  ) THEN
    CREATE TRIGGER trg_compliance_frameworks_touch
      BEFORE UPDATE ON compliance_frameworks
      FOR EACH ROW EXECUTE FUNCTION universal_juris_touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_regulator_definitions_touch'
  ) THEN
    CREATE TRIGGER trg_regulator_definitions_touch
      BEFORE UPDATE ON regulator_definitions
      FOR EACH ROW EXECUTE FUNCTION universal_juris_touch_updated_at();
  END IF;
END $$;

COMMIT;
