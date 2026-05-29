-- =============================================================================
-- Migration 0143 — Regulator jurisdictions + tenant.regulator_set +
--                   currency / language / mineral allowlist generalisation.
--
-- Companion to:
--   - services/api-gateway/src/services/tenant-config/*
--   - packages/database/src/schemas/regulator-jurisdictions.schema.ts
--   - packages/database/src/seeds/regulator-jurisdictions.seed.ts
--   - Docs/OPS/WORLD_SCALE_TENANTS.md
--
-- Issue #207 — World-scale tenant config.
--   Borjie is global from day one. Tanzania is the GTM beachhead, NOT a
--   hardcode. This migration:
--
--     1. Creates `regulator_jurisdictions` — tenant-AGNOSTIC catalogue
--        of regulatory authorities per country (TZ PCCB/NEMC/EITI/TMAA,
--        KE Mining Office/NEMA/EITI, NG MID/NESREA/NEITI, ZA DMR/DEAT,
--        AU Geoscience Australia/EPA Vic, CL SERNAGEOMIN/COCHILCO,
--        ID ESDM/MEMR, generic fallback). One row per (country, name_en).
--
--     2. Adds `tenants.regulator_set` — the active regulator set the
--        tenant operates under (TZ-set / KE-set / UG-set / NG-set /
--        ZA-set / AU-set / CL-set / ID-set / generic). Defaults to
--        'TZ-set' so existing Tanzanian rows stay binary-identical.
--
--     3. Adds `tenants.country_code` — ISO-3166-1 alpha-2. The legacy
--        `country` column is kept untouched; `country_code` is the
--        canonical column the tenant-config service reads. Defaults to
--        'TZ' so existing rows stay binary-identical. NOT-NULL via
--        backfill at end of migration.
--
--     4. Widens `tenants_primary_currency_chk` to admit ZAR, AUD, CLP,
--        IDR (alongside the existing TZS / USD / KES / UGX / NGN / EUR).
--        TZS remains the default — TZ tenants see no behavioural change.
--
--     5. Widens `tenants_default_language_chk` to admit fr / pt / sw-KE
--        alongside sw / en. sw remains the default — TZ tenants see no
--        behavioural change. New tenants pick their language at signup.
--
--     6. Adds `tenants.allowed_minerals` — JSONB array of mineral
--        canonical slugs the tenant is licensed to handle. Defaults to
--        the TZ-set (gold, tanzanite, ruby, sapphire, copper, coal,
--        iron-ore, nickel, lithium, graphite, gemstone, diamond) for
--        backward compat. A `mineral_kinds` global catalogue is NOT
--        introduced here — the tenant.allowed_minerals column is the
--        per-tenant override; future migration may promote it.
--
-- Tenant scope:
--   * `regulator_jurisdictions` is tenant-AGNOSTIC (same model as
--     `regulatory_zones` and `intelligence_corpus_chunks`) — regulators
--     publish the same authority list to every operator.
--   * `tenants.regulator_set` / `country_code` / `allowed_minerals` are
--     per-row on tenants — RLS already covers the parent table.
--
-- Hard rules:
--   * Idempotent. Forward-only. Append-only. NEVER edited after merge.
--   * NO breaking changes — TZ defaults stay identical. World expansion
--     is purely additive (every new column has a default, every new
--     CHECK constraint widens an existing one).
--   * NEVER hard-code TZS / sw / TZ outside this migration. The
--     application layer must read `tenant.default_currency`,
--     `tenant.default_language`, `tenant.regulator_set` from the
--     tenant-config service.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── §1. regulator_jurisdictions (tenant-agnostic catalogue) ─────────────────
CREATE TABLE IF NOT EXISTS regulator_jurisdictions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  /** ISO-3166-1 alpha-2 country code. */
  country_code             text        NOT NULL,
  /** Authority name in English — e.g. 'PCCB', 'Mining Office', 'SERNAGEOMIN'. */
  name_en                  text        NOT NULL,
  /** Authority name in the local language (sw / fr / pt / es / id / etc.). */
  name_local               text,
  /** Short slug for code-side switches — e.g. 'pccb', 'sernageomin'. */
  slug                     text        NOT NULL,
  /** Regulator set the row belongs to — drives tenant.regulator_set joins. */
  regulator_set            text        NOT NULL,
  /** Mandate type — 'anti-corruption', 'environment', 'transparency',
   *  'mining-licensing', 'safety', 'royalty', 'tax', 'transparency-eiti',
   *  'generic'.
   */
  mandate                  text        NOT NULL,
  /** Public URL — landing page / contact / inspector portal. */
  contact_url              text,
  /** Endpoint the api-gateway POSTs Data Subject Requests to (optional). */
  dsr_endpoint             text,
  /** Endpoint for licence-renewal status checks (optional). */
  licence_renewal_endpoint text,
  /** Free-form metadata (e.g. region, currency, kyc-bundle slug). */
  attributes               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  active_from              date,
  active_until             date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulator_jurisdictions_country_chk'
  ) THEN
    ALTER TABLE regulator_jurisdictions
      ADD CONSTRAINT regulator_jurisdictions_country_chk
      CHECK (char_length(country_code) = 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulator_jurisdictions_set_chk'
  ) THEN
    ALTER TABLE regulator_jurisdictions
      ADD CONSTRAINT regulator_jurisdictions_set_chk
      CHECK (regulator_set IN (
        'TZ-set', 'KE-set', 'UG-set', 'NG-set', 'ZA-set',
        'AU-set', 'CL-set', 'ID-set', 'generic'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'regulator_jurisdictions_mandate_chk'
  ) THEN
    ALTER TABLE regulator_jurisdictions
      ADD CONSTRAINT regulator_jurisdictions_mandate_chk
      CHECK (mandate IN (
        'anti-corruption',
        'environment',
        'transparency-eiti',
        'mining-licensing',
        'safety',
        'royalty',
        'tax',
        'generic'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS regulator_jurisdictions_set_slug_unq
  ON regulator_jurisdictions (regulator_set, slug);

CREATE INDEX IF NOT EXISTS regulator_jurisdictions_country_idx
  ON regulator_jurisdictions (country_code);

CREATE INDEX IF NOT EXISTS regulator_jurisdictions_set_idx
  ON regulator_jurisdictions (regulator_set);

-- Tenant-agnostic catalogue — no RLS (same model as `regulatory_zones`).

-- ─── §2. tenants.regulator_set ───────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS regulator_set text NOT NULL DEFAULT 'TZ-set';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_regulator_set_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_regulator_set_chk
      CHECK (regulator_set IN (
        'TZ-set', 'KE-set', 'UG-set', 'NG-set', 'ZA-set',
        'AU-set', 'CL-set', 'ID-set', 'generic'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_regulator_set_idx
  ON tenants (regulator_set);

-- ─── §3. tenants.country_code (canonical ISO-3166-1 alpha-2) ─────────────────
-- Legacy `country` column is preserved untouched. `country_code` is the
-- canonical column the tenant-config service reads.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'TZ';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_country_code_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_country_code_chk
      CHECK (char_length(country_code) = 2);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenants_country_code_idx
  ON tenants (country_code);

-- ─── §4. Widen primary_currency CHECK to admit ZAR/AUD/CLP/IDR ───────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_primary_currency_chk'
  ) THEN
    ALTER TABLE tenants DROP CONSTRAINT tenants_primary_currency_chk;
  END IF;
  ALTER TABLE tenants
    ADD CONSTRAINT tenants_primary_currency_chk
    CHECK (primary_currency IN (
      'TZS', 'USD', 'KES', 'UGX', 'NGN', 'EUR',
      'ZAR', 'AUD', 'CLP', 'IDR'
    ));
END $$;

-- ─── §5. Widen default_language CHECK to admit fr/pt/sw-KE ───────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_default_language_chk'
  ) THEN
    ALTER TABLE tenants DROP CONSTRAINT tenants_default_language_chk;
  END IF;
  ALTER TABLE tenants
    ADD CONSTRAINT tenants_default_language_chk
    CHECK (default_language IN (
      'sw', 'en', 'fr', 'pt', 'sw-KE', 'es', 'id'
    ));
END $$;

-- ─── §6. tenants.allowed_minerals (per-tenant allowlist) ─────────────────────
-- Defaults to the TZ-set so existing rows behave identically.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS allowed_minerals jsonb NOT NULL DEFAULT
    '["gold","tanzanite","ruby","sapphire","copper","coal","iron-ore","nickel","lithium","graphite","gemstone","diamond"]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_allowed_minerals_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_allowed_minerals_chk
      CHECK (jsonb_typeof(allowed_minerals) = 'array');
  END IF;
END $$;

COMMIT;
