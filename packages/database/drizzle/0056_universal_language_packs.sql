-- =============================================================================
-- Migration 0056 — Universal Language Packs (UNIV-2)
--
-- Spec: Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md
-- Founder lock: Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md
--
-- Creates `language_pack_definitions` — the canonical global registry of
-- every language pack Mr. Mwikila supports (live or reserved). Adding a
-- new language to Borjie is a single row insert + a new
-- `@borjie/language-pack-{code}` package; no core code change, no
-- migration churn.
--
-- DESIGN NOTE — NO RLS.
-- This table is a global reference dataset, not a tenant-scoped artefact.
-- Pack definitions are identical for every tenant ("English is English";
-- "Swahili is Swahili"). RLS would force pointless predicate evaluation
-- on every read. Instead, write access is gated at the application layer
-- (the seed module + the registry boot path are the only writers) and
-- read access is unrestricted — every tenant reads the same 30 rows.
--
-- Per-tenant *preferences* over packs (e.g. "tenant X prefers en-TZ over
-- en-GB", "tenant Y disables sw-KE", "tenant Z installs only en + sw")
-- ride on a separate tenant-scoped `tenant_language_pack_prefs` table
-- which we will add in a follow-up migration (out of scope for UNIV-2;
-- the pack-definition registry is the foundation).
--
-- One table:
--   1. language_pack_definitions — one row per pack (live or reserved).
--      PRIMARY KEY (id) where id = canonical pack id (BCP-47 primary
--      subtag for monolingual packs, full BCP-47 tag for region-locked
--      packs).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. language_pack_definitions — global pack registry
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_pack_definitions (
  /** canonical pack id; equals bcp47 for region-locked packs */
  id                       text PRIMARY KEY,

  /** IETF BCP-47 language tag per RFC 5646 (e.g. 'en', 'sw-TZ', 'zh-CN') */
  bcp47                    text NOT NULL,

  /** ISO 639-1 two-letter code (NULL if the language has no 639-1 entry) */
  iso_639_1                text,

  /** ISO 639-2 three-letter bibliographic code (NULL if absent) */
  iso_639_2                text,

  /** ISO 639-3 three-letter individual-language code */
  iso_639_3                text NOT NULL,

  /** native display name (e.g. 'English', 'Kiswahili', 'Français', 'العربية') */
  native_name              text NOT NULL,

  /** English display name (e.g. 'English', 'Swahili', 'French', 'Arabic') */
  english_name             text NOT NULL,

  /** ISO 15924 script identifier (e.g. 'Latn', 'Arab', 'Cyrl', 'Hans', 'Deva') */
  script                   text NOT NULL,

  /** TRUE for right-to-left scripts (ar, he, fa, ur). FALSE otherwise. */
  is_rtl                   boolean NOT NULL DEFAULT FALSE,

  /** lifecycle: 'live' = implementation package shipped; 'reserved' = definition only */
  status                   text NOT NULL,

  /** BCP-47 region variants this pack supports (e.g. ['en-GB','en-US','en-TZ'])
      Empty array for monolingual packs without regional sub-variants. */
  region_variants          text[] NOT NULL DEFAULT ARRAY[]::text[],

  /** ISO 639-3 macrolanguage id if this pack is a member of one (else NULL) */
  macrolanguage            text,

  /** pointer to the implementation package id for live packs
      (e.g. '@borjie/language-pack-en'); NULL for reserved packs */
  implementation_package   text,

  /** optional pointer to a morphology package (e.g. '@borjie/swahili-linguistics') */
  morphology_package_id    text,

  /** primary citation URL for the pack's standardisation reference */
  citation_url             text NOT NULL,

  /** human-readable citation title (e.g. "RFC 5646", "ISO 639-3 SIL") */
  citation_title           text NOT NULL,

  /** ISO date the citation was last verified */
  citation_accessed_at     text NOT NULL,

  /** audit-hash for tamper detection (computed at row insert time) */
  audit_hash               text NOT NULL,

  /** when this row was inserted */
  created_at               timestamptz NOT NULL DEFAULT NOW(),

  /** when this row was last updated (status transitions, citation refreshes) */
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Constraints
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_pack_definitions_status_chk'
  ) THEN
    ALTER TABLE language_pack_definitions
      ADD CONSTRAINT language_pack_definitions_status_chk
      CHECK (status IN ('live', 'reserved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_pack_definitions_bcp47_chk'
  ) THEN
    ALTER TABLE language_pack_definitions
      ADD CONSTRAINT language_pack_definitions_bcp47_chk
      CHECK (length(bcp47) BETWEEN 2 AND 35);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_pack_definitions_iso639_3_chk'
  ) THEN
    ALTER TABLE language_pack_definitions
      ADD CONSTRAINT language_pack_definitions_iso639_3_chk
      CHECK (length(iso_639_3) = 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_pack_definitions_script_chk'
  ) THEN
    ALTER TABLE language_pack_definitions
      ADD CONSTRAINT language_pack_definitions_script_chk
      CHECK (length(script) = 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'language_pack_definitions_impl_live_chk'
  ) THEN
    ALTER TABLE language_pack_definitions
      ADD CONSTRAINT language_pack_definitions_impl_live_chk
      CHECK (
        (status = 'reserved' AND implementation_package IS NULL)
        OR (status = 'live' AND implementation_package IS NOT NULL)
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_language_pack_definitions_bcp47
  ON language_pack_definitions (bcp47);

CREATE INDEX IF NOT EXISTS idx_language_pack_definitions_iso_639_1
  ON language_pack_definitions (iso_639_1)
  WHERE iso_639_1 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_language_pack_definitions_iso_639_3
  ON language_pack_definitions (iso_639_3);

CREATE INDEX IF NOT EXISTS idx_language_pack_definitions_status
  ON language_pack_definitions (status);

CREATE INDEX IF NOT EXISTS idx_language_pack_definitions_script
  ON language_pack_definitions (script);

CREATE INDEX IF NOT EXISTS idx_language_pack_definitions_rtl
  ON language_pack_definitions (is_rtl)
  WHERE is_rtl = TRUE;

-- -----------------------------------------------------------------------------
-- NO Row-Level Security
-- -----------------------------------------------------------------------------
-- Intentional. This is a global reference dataset. Every tenant reads
-- the same 30 rows; RLS would impose useless predicate cost on every
-- query. Tenant-specific *preferences* over packs live in a separate
-- table (see header comment).

COMMENT ON TABLE language_pack_definitions IS
  'UNIV-2 — global registry of language packs (live + reserved). 30 rows at launch (2 live, 28 reserved). No RLS by design — global reference dataset. Spec: Docs/DESIGN/UNIVERSAL_LANGUAGE_PACKS_SPEC.md.';

COMMENT ON COLUMN language_pack_definitions.id IS
  'Canonical pack id. Equals BCP-47 primary subtag for monolingual packs (en, sw, fr) and the full BCP-47 tag for region-locked packs (sw-TZ, zh-CN). PRIMARY KEY.';

COMMENT ON COLUMN language_pack_definitions.bcp47 IS
  'IETF BCP-47 language tag per RFC 5646. UNIQUE.';

COMMENT ON COLUMN language_pack_definitions.iso_639_3 IS
  'ISO 639-3 three-letter individual-language code. Maintained by SIL International. NOT NULL.';

COMMENT ON COLUMN language_pack_definitions.script IS
  'ISO 15924 four-letter script identifier (Latn, Arab, Cyrl, Hans, Deva, Ethi, ...).';

COMMENT ON COLUMN language_pack_definitions.status IS
  'live = implementation package shipped; reserved = definition only, no implementation module.';

COMMENT ON COLUMN language_pack_definitions.implementation_package IS
  'NPM package name (e.g. @borjie/language-pack-en) for live packs. NULL for reserved packs.';

COMMIT;
