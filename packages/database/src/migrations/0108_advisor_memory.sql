-- =============================================================================
-- Migration 0108 — Advisor Memory (Wave BRAIN-DEPTH)
--
-- Companion to:
--   - services/api-gateway/src/services/advisor-memory/
--   - services/api-gateway/src/routes/brain-teach.hono.ts
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Cross-session persistent memory for the brain advisor. Two tables let
-- the brain remember WHO the owner is across chat sessions instead of
-- starting from a blank slate every turn:
--
--   1. advisor_preferences  — typed preferences keyed by tenant.
--      Stable axes (communication_style, default_brief_cadence,
--      mastery_levels) the owner has either declared or the brain has
--      inferred from sustained behaviour.
--
--   2. advisor_observed_patterns — pattern recognition. The brain emits
--      observations as it learns (e.g. "owner files royalty around the
--      12th"; "owner asks 'how much did I make' weekly"). The same
--      pattern increments `occurrences` and bumps `last_seen_at` so
--      durable patterns rise above one-off noise.
--
-- Both tables are tenant-scoped via the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS predicate. RLS is
-- FORCE-enabled per the Borjie hard rule (CLAUDE.md).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) advisor_preferences — typed cross-session preferences per tenant.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS advisor_preferences (
  tenant_id                text         PRIMARY KEY,
  /** ISO 639-1 language code; defaults to Swahili per CLAUDE.md
   *  ("Swahili-first. Default user language is `sw`"). */
  language                 text         NOT NULL DEFAULT 'sw',
  /** IANA tz database id (e.g. Africa/Dar_es_Salaam). */
  time_zone                text         NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  /** How often the owner wants the daily/weekly brief delivered. */
  default_brief_cadence    text         NOT NULL DEFAULT 'daily',
  /** Communication register the brain should use.
   *  concise  → 1-3 short sentences, lead with the number
   *  detailed → paragraph with rationale + a single recommendation
   *  technical → domain shorthand + citations, no glossing
   */
  communication_style      text         NOT NULL DEFAULT 'concise',
  /** Preferred channels (email|sms|slack|whatsapp). */
  preferred_channels       jsonb        NOT NULL DEFAULT '["email"]'::jsonb,
  /** DND windows. Shape: [{"start":"22:00","end":"06:00","days":[0,6]}]. */
  do_not_disturb           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  /** Wall-clock the last MasteryGate teaching was completed. */
  last_taught_at           timestamptz,
  /** Domain → mastery level (novice|intermediate|expert). */
  mastery_levels           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  /** Cumulative friction signals the brain has observed. Shape:
   *  {"dropped_turns":3,"rejected_recommendations":1}. */
  friction_signals         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_at               timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'advisor_preferences_style_chk'
  ) THEN
    ALTER TABLE advisor_preferences
      ADD CONSTRAINT advisor_preferences_style_chk
      CHECK (communication_style IN ('concise', 'detailed', 'technical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'advisor_preferences_cadence_chk'
  ) THEN
    ALTER TABLE advisor_preferences
      ADD CONSTRAINT advisor_preferences_cadence_chk
      CHECK (default_brief_cadence IN ('hourly', 'daily', 'weekly', 'monthly', 'off'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'advisor_preferences_language_chk'
  ) THEN
    ALTER TABLE advisor_preferences
      ADD CONSTRAINT advisor_preferences_language_chk
      CHECK (language IN ('sw', 'en'));
  END IF;
END $$;

ALTER TABLE advisor_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_preferences FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'advisor_preferences'
       AND policyname = 'advisor_preferences_tenant_isolation'
  ) THEN
    CREATE POLICY advisor_preferences_tenant_isolation
      ON advisor_preferences
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) advisor_observed_patterns — recurring behavioural signal store.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS advisor_observed_patterns (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text         NOT NULL,
  /** routine        — recurring action (files royalty by 12th)
   *  aversion       — kind of recommendation the owner repeatedly rejects
   *  peak_time      — sustained interaction time window
   *  recurring_question — same question reappears across sessions
   */
  pattern_kind      text         NOT NULL,
  /** Shape varies by kind:
   *  routine            → {"action":"royalty_file","day_of_month":12}
   *  aversion           → {"recommendation_kind":"hire_security"}
   *  peak_time          → {"start":"06:00","end":"08:00"}
   *  recurring_question → {"question":"how much did I make this month"}
   */
  pattern_payload   jsonb        NOT NULL,
  /** Bayesian confidence [0,1] the pattern is real. Grows with
   *  occurrences and decays under contradiction. */
  confidence        numeric(4,3) NOT NULL DEFAULT 0.500,
  first_seen_at     timestamptz  NOT NULL DEFAULT now(),
  last_seen_at      timestamptz  NOT NULL DEFAULT now(),
  occurrences       integer      NOT NULL DEFAULT 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'advisor_observed_patterns_kind_chk'
  ) THEN
    ALTER TABLE advisor_observed_patterns
      ADD CONSTRAINT advisor_observed_patterns_kind_chk
      CHECK (pattern_kind IN ('routine', 'aversion', 'peak_time', 'recurring_question'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'advisor_observed_patterns_confidence_chk'
  ) THEN
    ALTER TABLE advisor_observed_patterns
      ADD CONSTRAINT advisor_observed_patterns_confidence_chk
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'advisor_observed_patterns_occurrences_chk'
  ) THEN
    ALTER TABLE advisor_observed_patterns
      ADD CONSTRAINT advisor_observed_patterns_occurrences_chk
      CHECK (occurrences >= 1);
  END IF;
END $$;

-- Hot path: read top-N patterns per (tenant, kind) ordered by salience
-- (occurrences * confidence). Salience is computed in the service layer;
-- the index keeps the per-(tenant, kind) slice small.
CREATE INDEX IF NOT EXISTS idx_advisor_observed_patterns_tenant_kind
  ON advisor_observed_patterns (tenant_id, pattern_kind, last_seen_at DESC);

-- Upsert hot path: the recordObservation service deduplicates by a
-- canonical payload signature stored in `pattern_payload->>'signature'`.
-- This partial functional index covers the lookup without polluting the
-- catalog for rows that omit the signature.
CREATE INDEX IF NOT EXISTS idx_advisor_observed_patterns_signature
  ON advisor_observed_patterns (tenant_id, pattern_kind, (pattern_payload->>'signature'))
  WHERE pattern_payload ? 'signature';

ALTER TABLE advisor_observed_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_observed_patterns FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'advisor_observed_patterns'
       AND policyname = 'advisor_observed_patterns_tenant_isolation'
  ) THEN
    CREATE POLICY advisor_observed_patterns_tenant_isolation
      ON advisor_observed_patterns
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
