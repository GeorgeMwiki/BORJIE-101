-- =============================================================================
-- Migration 0049 — Swahili Linguistics (Wave 19H).
--
-- Spec: Docs/DESIGN/SWAHILI_LINGUISTICS_SOTA_SPEC.md
--
-- Three tenant-scoped tables backing the @borjie/swahili-linguistics
-- morphology + glossary + dialect layer:
--
--   - swahili_terms                 bilingual glossary entries (terms,
--                                   lemmas, noun classes, register, domain
--                                   tags). Mining-domain seed lives in TS.
--   - swahili_morphology_cache      memoised morphological analyses per
--                                   surface form. Verb decompositions, noun
--                                   class detections, confidence scores.
--   - swahili_dialect_signals       per-user dialect-signal counters
--                                   accumulating across utterances; drives
--                                   register adaptation.
--
-- All three tables are tenant-scoped with RLS via the canonical
-- `current_setting('app.tenant_id', true)` GUC pattern. Idempotent
-- (`IF NOT EXISTS` + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. swahili_terms — bilingual glossary entries (mining-domain seed in TS)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swahili_terms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  /** Surface form (canonical orthography). */
  term                text NOT NULL,
  /** Lemma — uninflected root form. */
  lemma               text NOT NULL,
  /** Bantu noun class 1-18 (NULL for non-nouns). */
  noun_class          integer,
  /** Plural class (NULL for singletons / mass nouns / non-nouns). */
  plural_class        integer,
  /** formal | colloquial | sheng | coastal | bongo. */
  register            text NOT NULL DEFAULT 'formal',
  /** Domain tag: licensing | tax | royalty | environment | operations | trade | core | governance. */
  domain              text NOT NULL DEFAULT 'core',
  /** English equivalent (single canonical). */
  en_equivalent       text NOT NULL,
  /** Bilingual definition: { sw: ..., en: ... }. */
  definition          jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Citation: { url, title, accessedAt }. */
  citation            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  UNIQUE (tenant_id, term, register)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swahili_terms_register_chk'
  ) THEN
    ALTER TABLE swahili_terms
      ADD CONSTRAINT swahili_terms_register_chk
      CHECK (register IN ('formal','colloquial','sheng','coastal','bongo'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swahili_terms_noun_class_chk'
  ) THEN
    ALTER TABLE swahili_terms
      ADD CONSTRAINT swahili_terms_noun_class_chk
      CHECK (noun_class IS NULL OR (noun_class BETWEEN 1 AND 18));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swahili_terms_plural_class_chk'
  ) THEN
    ALTER TABLE swahili_terms
      ADD CONSTRAINT swahili_terms_plural_class_chk
      CHECK (plural_class IS NULL OR (plural_class BETWEEN 1 AND 18));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_swahili_terms_tenant_domain
  ON swahili_terms (tenant_id, domain);

CREATE INDEX IF NOT EXISTS idx_swahili_terms_tenant_lemma
  ON swahili_terms (tenant_id, lemma);

CREATE INDEX IF NOT EXISTS idx_swahili_terms_tenant_register
  ON swahili_terms (tenant_id, register);

ALTER TABLE swahili_terms ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'swahili_terms'
       AND policyname = 'swahili_terms_tenant_isolation'
  ) THEN
    CREATE POLICY swahili_terms_tenant_isolation ON swahili_terms
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. swahili_morphology_cache — memoised morphological analyses
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swahili_morphology_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  /** Surface form analysed. */
  surface_form        text NOT NULL,
  /** Lemma — recovered uninflected stem. */
  lemma               text NOT NULL,
  /** Morpheme decomposition: array of { kind, value, slot }. */
  morphemes           jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Part-of-speech tag: noun | verb | adj | adv | pron | num | conj | prep | particle. */
  pos                 text NOT NULL,
  /** Per-POS features: { class?: int, tam?: text, subj?: text, obj?: text, fv?: text, ... }. */
  features            jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Confidence in the analysis, 0..1. */
  confidence          real NOT NULL DEFAULT 1.0,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  UNIQUE (tenant_id, surface_form)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swahili_morphology_confidence_chk'
  ) THEN
    ALTER TABLE swahili_morphology_cache
      ADD CONSTRAINT swahili_morphology_confidence_chk
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_morphology_cache_tenant_lemma
  ON swahili_morphology_cache (tenant_id, lemma);

CREATE INDEX IF NOT EXISTS idx_morphology_cache_tenant_pos
  ON swahili_morphology_cache (tenant_id, pos);

ALTER TABLE swahili_morphology_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'swahili_morphology_cache'
       AND policyname = 'swahili_morphology_cache_tenant_isolation'
  ) THEN
    CREATE POLICY swahili_morphology_cache_tenant_isolation ON swahili_morphology_cache
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. swahili_dialect_signals — per-user dialect-signal counters
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swahili_dialect_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  user_id             text NOT NULL,
  /** bongo | coastal | kenyan | sheng | standard. */
  dialect             text NOT NULL,
  /** Number of utterances scored as this dialect for this user. */
  signal_count        integer NOT NULL DEFAULT 0,
  last_observed       timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  UNIQUE (tenant_id, user_id, dialect)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swahili_dialect_signals_dialect_chk'
  ) THEN
    ALTER TABLE swahili_dialect_signals
      ADD CONSTRAINT swahili_dialect_signals_dialect_chk
      CHECK (dialect IN ('bongo','coastal','kenyan','sheng','standard'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swahili_dialect_signals_count_chk'
  ) THEN
    ALTER TABLE swahili_dialect_signals
      ADD CONSTRAINT swahili_dialect_signals_count_chk
      CHECK (signal_count >= 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_dialect_signals_tenant_user
  ON swahili_dialect_signals (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_dialect_signals_tenant_last_observed
  ON swahili_dialect_signals (tenant_id, last_observed DESC);

ALTER TABLE swahili_dialect_signals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'swahili_dialect_signals'
       AND policyname = 'swahili_dialect_signals_tenant_isolation'
  ) THEN
    CREATE POLICY swahili_dialect_signals_tenant_isolation ON swahili_dialect_signals
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
