-- =============================================================================
-- Migration 0050 — Translation SOTA (Wave 19I)
--
-- Companion to Docs/DESIGN/TRANSLATION_SOTA_SPEC.md.
--
-- Adds the persistence substrate for Mr. Mwikila's bidirectional
-- English<->Swahili translation runner that preserves mining /
-- regulatory / financial terminology (deterministic glossary lock),
-- code-switched segments, register / formality, and Tanzanian
-- honorifics ("ndugu", "dada", "mzee", …).
--
-- Three tenant-scoped tables:
--
--   1. translation_runs
--      - one row per translation call (each provider invocation).
--      - source_text + target_text, provider used, glossary terms
--        substituted, code-switch segment tagging, BLEU / chrF /
--        terminology-adherence scores, latency, cost.
--      - hash-chained via (prev_hash, audit_hash).
--
--   2. translation_glossary_overrides
--      - tenant-specific term overrides on top of bundled mining +
--        Wave-19H domain glossaries. UNIQUE(tenant_id, src_term,
--        src_lang, target_lang, register).
--
--   3. translation_evals
--      - one row per (run, judge) eval score. judge in {bleu, chrf,
--        comet, terminology-adherence, human}. Drives the nightly
--        drift dashboard.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. translation_runs — one row per provider call
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS translation_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  source_lang             text NOT NULL,
  target_lang             text NOT NULL,
  source_text             text NOT NULL,
  target_text             text NOT NULL,
  provider                text NOT NULL,
  glossary_terms_used     jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_switch_segments    jsonb NOT NULL DEFAULT '[]'::jsonb,
  bleu                    real,
  chrf                    real,
  terminology_adherence   real,
  latency_ms              int NOT NULL DEFAULT 0,
  cost_usd_cents          int NOT NULL DEFAULT 0,
  audit_hash              text NOT NULL,
  prev_hash               text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'translation_runs_lang_chk'
  ) THEN
    ALTER TABLE translation_runs
      ADD CONSTRAINT translation_runs_lang_chk
      CHECK (
        source_lang IN ('sw', 'en')
        AND target_lang IN ('sw', 'en')
        AND source_lang <> target_lang
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'translation_runs_provider_chk'
  ) THEN
    ALTER TABLE translation_runs
      ADD CONSTRAINT translation_runs_provider_chk
      CHECK (provider IN ('claude-opus-4-7', 'gemini-2-5-pro', 'nllb-200'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'translation_runs_metric_chk'
  ) THEN
    ALTER TABLE translation_runs
      ADD CONSTRAINT translation_runs_metric_chk
      CHECK (
        (bleu IS NULL OR (bleu >= 0 AND bleu <= 100))
        AND (chrf IS NULL OR (chrf >= 0 AND chrf <= 1))
        AND (
          terminology_adherence IS NULL
          OR (terminology_adherence >= 0 AND terminology_adherence <= 1)
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_translation_runs_tenant_recent
  ON translation_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_runs_provider
  ON translation_runs (tenant_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_runs_lang_pair
  ON translation_runs (tenant_id, source_lang, target_lang, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_runs_audit_hash
  ON translation_runs (audit_hash);

ALTER TABLE translation_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'translation_runs'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON translation_runs
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. translation_glossary_overrides — per-tenant term overrides
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS translation_glossary_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  src_term     text NOT NULL,
  src_lang     text NOT NULL,
  target_term  text NOT NULL,
  target_lang  text NOT NULL,
  domain       text NOT NULL DEFAULT 'general',
  register     text NOT NULL DEFAULT 'neutral',
  source_url   text,
  audit_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'translation_glossary_overrides_lang_chk'
  ) THEN
    ALTER TABLE translation_glossary_overrides
      ADD CONSTRAINT translation_glossary_overrides_lang_chk
      CHECK (
        src_lang IN ('sw', 'en')
        AND target_lang IN ('sw', 'en')
        AND src_lang <> target_lang
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'translation_glossary_overrides_domain_chk'
  ) THEN
    ALTER TABLE translation_glossary_overrides
      ADD CONSTRAINT translation_glossary_overrides_domain_chk
      CHECK (
        domain IN ('mining', 'regulatory', 'financial', 'safety', 'general')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'translation_glossary_overrides_register_chk'
  ) THEN
    ALTER TABLE translation_glossary_overrides
      ADD CONSTRAINT translation_glossary_overrides_register_chk
      CHECK (register IN ('formal', 'neutral', 'casual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'translation_glossary_overrides_unique'
  ) THEN
    ALTER TABLE translation_glossary_overrides
      ADD CONSTRAINT translation_glossary_overrides_unique
      UNIQUE (tenant_id, src_term, src_lang, target_lang, register);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_translation_glossary_overrides_tenant
  ON translation_glossary_overrides (tenant_id, domain);

CREATE INDEX IF NOT EXISTS idx_translation_glossary_overrides_term
  ON translation_glossary_overrides (tenant_id, src_lang, lower(src_term));

CREATE INDEX IF NOT EXISTS idx_translation_glossary_overrides_audit_hash
  ON translation_glossary_overrides (audit_hash);

ALTER TABLE translation_glossary_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'translation_glossary_overrides'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON translation_glossary_overrides
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. translation_evals — per-(run, judge) eval score
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS translation_evals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  run_id       uuid NOT NULL REFERENCES translation_runs(id) ON DELETE CASCADE,
  judge        text NOT NULL,
  score        real NOT NULL,
  rubric       jsonb NOT NULL DEFAULT '{}'::jsonb,
  judged_at    timestamptz NOT NULL DEFAULT now(),
  audit_hash   text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'translation_evals_judge_chk'
  ) THEN
    ALTER TABLE translation_evals
      ADD CONSTRAINT translation_evals_judge_chk
      CHECK (
        judge IN ('bleu', 'chrf', 'comet', 'terminology-adherence', 'human')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'translation_evals_score_chk'
  ) THEN
    ALTER TABLE translation_evals
      ADD CONSTRAINT translation_evals_score_chk
      CHECK (score >= 0 AND score <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_translation_evals_run
  ON translation_evals (run_id, judged_at);

CREATE INDEX IF NOT EXISTS idx_translation_evals_tenant_recent
  ON translation_evals (tenant_id, judged_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_evals_judge
  ON translation_evals (tenant_id, judge, judged_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_evals_audit_hash
  ON translation_evals (audit_hash);

ALTER TABLE translation_evals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'translation_evals'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON translation_evals
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
