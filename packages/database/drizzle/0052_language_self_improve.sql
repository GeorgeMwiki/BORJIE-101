-- =============================================================================
-- Migration 0052 — Language Self-Improvement Loop (Wave 19K)
--
-- Spec: Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md
--
-- Adds the persistence substrate for Mr. Mwikila's continuous Swahili (and
-- multilingual) improvement loop. Captured utterances (consent-gated by
-- Wave 19J ambient-listener or chat channel) are scored on four axes (WER,
-- PER, grammar, terminology), curated, minted into either a per-tenant
-- LoRA adapter or a rag-prefix, evaluated against the 200-entry extended
-- gauntlet plus per-tenant additions, and promoted / rolled-back per the
-- decision rules in §6 of the spec.
--
-- Four tables:
--   1. language_training_pairs   — one row per captured (source, target)
--                                   utterance pair + 4-axis scores. PII
--                                   passes through the redactor before
--                                   persistence (FOUNDER_LOCKED §1.3 +
--                                   §1.4 apply).
--   2. language_adapters         — one row per minted adapter version per
--                                   (tenant, lang). lifecycle:
--                                   training → staged → live → rolled-back
--                                   | deprecated. UNIQUE on
--                                   (tenant_id, lang, version).
--   3. language_eval_runs        — one row per gauntlet eval. Carries the
--                                   4-axis aggregate metrics + MOS + the
--                                   PromotionDecider decision.
--   4. language_gauntlet_entries — per-tenant additions to the base 200-
--                                   utterance set shipped in TS. UNIQUE on
--                                   (tenant_id, lang, prompt).
--
-- All four tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. language_training_pairs — one row per captured (source, target) pair
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_training_pairs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL,
  source_text          text NOT NULL,
  target_text          text NOT NULL,
  lang                 text NOT NULL,
  utterance_id         text,
  /** 4-axis scores {wer, per, grammar, terminology, aggregate, recipient_consent}. */
  scores               jsonb NOT NULL DEFAULT '{}'::jsonb,
  included             boolean NOT NULL DEFAULT true,
  exclusion_reason     text,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash           text NOT NULL,
  prev_hash            text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_training_pairs_inclusion_chk'
  ) THEN
    ALTER TABLE language_training_pairs
      ADD CONSTRAINT language_training_pairs_inclusion_chk
      CHECK (
        (included = true AND exclusion_reason IS NULL) OR
        (included = false AND exclusion_reason IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_language_training_pairs_tenant
  ON language_training_pairs (tenant_id, lang, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_training_pairs_included
  ON language_training_pairs (tenant_id, lang, included, recorded_at DESC);

ALTER TABLE language_training_pairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS language_training_pairs_tenant_read ON language_training_pairs;
CREATE POLICY language_training_pairs_tenant_read ON language_training_pairs
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE language_training_pairs IS
  'Wave 19K — captured (source, target) utterance pair + 4-axis scores (WER, PER, grammar, terminology). PII redacted before persistence. FOUNDER_LOCKED §1.3 + §1.4 govern consent_state.';

-- -----------------------------------------------------------------------------
-- 2. language_adapters — one row per minted adapter version per (tenant, lang)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_adapters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL,
  lang                  text NOT NULL,
  version               text NOT NULL,
  /** lora | rag-prefix | full-ft */
  adapter_kind          text NOT NULL,
  /** Base model identifier (e.g. claude-sonnet-4.5, gpt-realtime-2). */
  base_model            text NOT NULL,
  training_pair_count   integer NOT NULL DEFAULT 0,
  /** training | staged | live | rolled-back | deprecated */
  status                text NOT NULL DEFAULT 'training',
  created_at            timestamptz NOT NULL DEFAULT now(),
  audit_hash            text NOT NULL,
  CONSTRAINT language_adapters_unique_version UNIQUE (tenant_id, lang, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_adapters_kind_chk'
  ) THEN
    ALTER TABLE language_adapters
      ADD CONSTRAINT language_adapters_kind_chk
      CHECK (adapter_kind IN ('lora', 'rag-prefix', 'full-ft'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_adapters_status_chk'
  ) THEN
    ALTER TABLE language_adapters
      ADD CONSTRAINT language_adapters_status_chk
      CHECK (status IN (
        'training', 'staged', 'live', 'rolled-back', 'deprecated'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_language_adapters_tenant
  ON language_adapters (tenant_id, lang, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_adapters_status
  ON language_adapters (tenant_id, lang, status, created_at DESC);

ALTER TABLE language_adapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS language_adapters_tenant_read ON language_adapters;
CREATE POLICY language_adapters_tenant_read ON language_adapters
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE language_adapters IS
  'Wave 19K — per-(tenant, lang) adapter. Kind in (lora, rag-prefix, full-ft). Lifecycle: training → staged → live → rolled-back | deprecated. UNIQUE(tenant_id, lang, version).';

-- -----------------------------------------------------------------------------
-- 3. language_eval_runs — one row per gauntlet eval
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_eval_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  adapter_id          uuid REFERENCES language_adapters(id) ON DELETE CASCADE,
  gauntlet_version    text NOT NULL,
  wer                 real NOT NULL DEFAULT 0,
  per                 real NOT NULL DEFAULT 0,
  grammar_score       real NOT NULL DEFAULT 0,
  terminology_score   real NOT NULL DEFAULT 0,
  /** Mean Opinion Score [1, 5]; null until human raters fill it. */
  mos                 real,
  /** promote | rollback | no-op */
  decision            text NOT NULL DEFAULT 'no-op',
  ran_at              timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_eval_runs_decision_chk'
  ) THEN
    ALTER TABLE language_eval_runs
      ADD CONSTRAINT language_eval_runs_decision_chk
      CHECK (decision IN ('promote', 'rollback', 'no-op'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_eval_runs_wer_chk'
  ) THEN
    ALTER TABLE language_eval_runs
      ADD CONSTRAINT language_eval_runs_wer_chk
      CHECK (wer >= 0 AND wer <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_eval_runs_per_chk'
  ) THEN
    ALTER TABLE language_eval_runs
      ADD CONSTRAINT language_eval_runs_per_chk
      CHECK (per >= 0 AND per <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_eval_runs_grammar_chk'
  ) THEN
    ALTER TABLE language_eval_runs
      ADD CONSTRAINT language_eval_runs_grammar_chk
      CHECK (grammar_score >= 0 AND grammar_score <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_eval_runs_terminology_chk'
  ) THEN
    ALTER TABLE language_eval_runs
      ADD CONSTRAINT language_eval_runs_terminology_chk
      CHECK (terminology_score >= 0 AND terminology_score <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_eval_runs_mos_chk'
  ) THEN
    ALTER TABLE language_eval_runs
      ADD CONSTRAINT language_eval_runs_mos_chk
      CHECK (mos IS NULL OR (mos >= 1 AND mos <= 5));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_language_eval_runs_tenant
  ON language_eval_runs (tenant_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_eval_runs_adapter
  ON language_eval_runs (adapter_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_eval_runs_decision
  ON language_eval_runs (tenant_id, decision, ran_at DESC);

ALTER TABLE language_eval_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS language_eval_runs_tenant_read ON language_eval_runs;
CREATE POLICY language_eval_runs_tenant_read ON language_eval_runs
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE language_eval_runs IS
  'Wave 19K — gauntlet eval run. 4 mechanical axes (WER, PER, grammar, terminology) + nullable MOS + PromotionDecider decision in (promote, rollback, no-op).';

-- -----------------------------------------------------------------------------
-- 4. language_gauntlet_entries — per-tenant additions to the base set
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_gauntlet_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  lang              text NOT NULL,
  prompt            text NOT NULL,
  expected_text     text NOT NULL,
  expected_intent   text,
  domain            text,
  /** bongo | coast | lake | sheng | other */
  dialect           text,
  audit_hash        text NOT NULL,
  CONSTRAINT language_gauntlet_entries_unique_prompt UNIQUE (tenant_id, lang, prompt)
);

CREATE INDEX IF NOT EXISTS idx_language_gauntlet_entries_tenant
  ON language_gauntlet_entries (tenant_id, lang);

CREATE INDEX IF NOT EXISTS idx_language_gauntlet_entries_dialect
  ON language_gauntlet_entries (tenant_id, lang, dialect);

ALTER TABLE language_gauntlet_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS language_gauntlet_entries_tenant_read ON language_gauntlet_entries;
CREATE POLICY language_gauntlet_entries_tenant_read ON language_gauntlet_entries
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE language_gauntlet_entries IS
  'Wave 19K — per-tenant additions to the base 200-utterance extended gauntlet. UNIQUE(tenant_id, lang, prompt) prevents duplicate additions.';

COMMIT;
