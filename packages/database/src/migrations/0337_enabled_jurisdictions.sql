-- =============================================================================
-- Migration 0337 — Generative jurisdiction onboarding: the launch-market spine.
--
-- WHY (commercialization keystone): jurisdiction must NEVER be hardcoded. Today
-- signup gates on a literal enum (['TZ','KE','UG','NG','OTHER']) — adding a
-- country is a code deploy. This migration turns "which countries can users
-- select" into DATA: an `enabled_countries` registry. We seed ONLY Tanzania, so
-- behaviour is identical to today (TZ-only), but unlocking a new market (e.g.
-- US) becomes a governed ROW INSERT after Mr. Mwikila has learned the
-- jurisdiction — not an engineering release.
--
-- THE FLOW THIS ENABLES (MD-core, generative, per CLAUDE.md):
--   1. internal admin uploads a country's compliance docs  → compliance_doc_uploads
--   2. the docs are ingested into the SHARED corpus (intelligence_corpus_chunks,
--      tenant_id = NULL) so jurisdiction-discovery `discover()` learns from them
--   3. an admin (or the MD via mwikila.jurisdiction.promote, four-eye-gated)
--      inserts the country into `enabled_countries`
--   4. signup reads `enabled_countries` → the country is now selectable
--   5. `region_overlays` supplies the per-country VAT/timezone/locale/phone the
--      compliance plugin does not carry — also data, also admin-extensible.
--
-- SCOPE: all three tables are PLATFORM-GLOBAL reference data (no tenant_id —
-- the same posture as `discovered_jurisdictions`, 0148). They hold no
-- tenant-private rows, so they are intentionally outside the tenant-RLS set.
-- Writes are governed at the application layer (admin-role + four-eye promotion
-- route); reads are public (a signup form must list countries pre-auth).
--
-- IDEMPOTENT + forward-only: CREATE TABLE IF NOT EXISTS, guarded seed.
-- Companion down: down/0337_down_enabled_jurisdictions.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- enabled_countries — the launch-market gate, expressed as data.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enabled_countries (
  code                 text PRIMARY KEY,           -- ISO-3166-1 alpha-2, UPPERCASE
  name                 text NOT NULL,
  currency_code        text,                        -- ISO-4217; NULL → resolve from plugin
  enabled_at           timestamptz NOT NULL DEFAULT now(),
  disabled_at          timestamptz,                 -- soft-disable without losing history
  enabled_by_admin_id  text,                        -- who promoted it (NULL for the TZ seed)
  learned_from_corpus  boolean NOT NULL DEFAULT false, -- true once compliance docs were ingested
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT enabled_countries_code_chk CHECK (length(code) BETWEEN 2 AND 3)
);

CREATE INDEX IF NOT EXISTS enabled_countries_active_idx
  ON enabled_countries (code)
  WHERE disabled_at IS NULL;

-- Seed the ONLY launch market: Tanzania. This row IS the "TZ-only for now" gate.
INSERT INTO enabled_countries (code, name, currency_code, enabled_by_admin_id, learned_from_corpus, metadata)
VALUES ('TZ', 'Tanzania', 'TZS', NULL, true,
        '{"launch": true, "seededBy": "migration-0337"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- region_overlays — per-country VAT/timezone/locale/phone the plugin lacks.
-- region-config.ts reads this as a DB fallback so a learned country needs no code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_overlays (
  country_code       text PRIMARY KEY,
  timezone           text,
  locale             text,
  phone_dialing_code text,
  phone_regex        text,
  phone_placeholder  text,
  vat_rate           numeric(5, 4),               -- e.g. 0.1800 for 18%
  tax_authority      text,                        -- e.g. 'TRA', 'KRA', 'IRS'
  taxpayer_id_label  text,                        -- e.g. 'TIN', 'PIN', 'EIN'
  extras             jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT region_overlays_code_chk CHECK (length(country_code) BETWEEN 2 AND 3)
);

-- -----------------------------------------------------------------------------
-- compliance_doc_uploads — provenance for admin-uploaded jurisdiction corpora.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance_doc_uploads (
  id                  text PRIMARY KEY,
  country_code        text NOT NULL,
  doc_type            text,                        -- 'tax' | 'licence' | 'labour' | …
  uploaded_by_admin_id text,
  file_path           text,                        -- vault/object-store key (never inline secrets)
  extraction_status   text NOT NULL DEFAULT 'pending', -- pending|extracting|ingested|failed
  corpus_chunk_count  integer NOT NULL DEFAULT 0,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_doc_uploads_code_chk CHECK (length(country_code) BETWEEN 2 AND 3)
);

CREATE INDEX IF NOT EXISTS compliance_doc_uploads_country_idx
  ON compliance_doc_uploads (country_code, uploaded_at DESC);

COMMENT ON TABLE enabled_countries IS
  'Launch-market gate as DATA: which ISO countries users may select at signup. '
  'Seeded with TZ only; new markets are promoted in via the governed '
  'mwikila.jurisdiction.promote four-eye flow once the MD has learned them. '
  'Jurisdiction is never hardcoded — adding a market is a row, not a deploy.';

COMMIT;
