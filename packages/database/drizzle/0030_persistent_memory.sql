-- =============================================================================
-- Migration 0030 — Persistent Memory + Skill Library schema (Wave 18GG)
--
-- Companion to docs/DESIGN/MEMORY_AMNESIA_PREVENTION_SOTA.md. Adds
-- four tables forming the temporal-continuity substrate so Mr.
-- Mwikila never forgets what he was doing, learned, tried, or what
-- worked or failed across crashes, restarts, context resets,
-- conversation handoffs, days, weeks, or months:
--
--   1. session_memory     — short-term memory tier. One row per
--                           (tenant, thread). Sliding-TTL summary of
--                           the last N turns + active decisions +
--                           pending questions. Tenant-scoped, RLS.
--   2. skills             — procedural memory tier (Voyager-style).
--                           Versioned by (id, version). Captures
--                           preconditions, ordered steps, post-
--                           conditions, success_rate, decay state.
--                           Tenant-scoped, RLS.
--   3. pending_threads    — anti-amnesia checkpoint table. One row
--                           per unresolved decision / approval /
--                           data_request / follow_up. Drives the
--                           "welcome back" resumption brief.
--                           Tenant-scoped, RLS.
--   4. thread_summaries   — MemGPT-style summarised blocks of turns
--                           older than the rolling working-set
--                           budget. Lossless (original turns remain
--                           in cognitive_turns). Tenant-scoped, RLS.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. session_memory — short-term tier, sliding-TTL working snapshot
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS session_memory (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  session_id          uuid NOT NULL,
  user_id             text NOT NULL,
  thread_id           uuid NOT NULL,
  summary_md          text NOT NULL,
  active_decisions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_questions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_turn_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  audit_hash          text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_thread
  ON session_memory (tenant_id, thread_id, last_turn_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_user
  ON session_memory (tenant_id, user_id, last_turn_at DESC);

ALTER TABLE session_memory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'session_memory'
       AND policyname = 'session_memory_tenant_isolation'
  ) THEN
    CREATE POLICY session_memory_tenant_isolation ON session_memory
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. skills — procedural memory tier (Voyager-style skill library)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skills (
  id                    text NOT NULL,
  version               int  NOT NULL,
  tenant_id             text NOT NULL,
  scope_id              text NOT NULL,
  intent                text NOT NULL,
  preconditions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  postconditions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_rate          numeric(3,2),
  invocations           int  NOT NULL DEFAULT 0,
  last_used_at          timestamptz,
  composed_from_skills  text[] NOT NULL DEFAULT ARRAY[]::text[],
  status                text NOT NULL DEFAULT 'observed',
  audit_hash            text NOT NULL,
  decayed_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT skills_status_chk CHECK (status IN (
    'observed','tested','canonical','deprecated'
  )),
  CONSTRAINT skills_success_range CHECK (
    success_rate IS NULL OR (success_rate >= 0 AND success_rate <= 1)
  )
);

CREATE INDEX IF NOT EXISTS idx_skills_tenant_intent
  ON skills (tenant_id, intent, status);
CREATE INDEX IF NOT EXISTS idx_skills_last_used
  ON skills (tenant_id, last_used_at DESC NULLS LAST)
  WHERE status IN ('observed','tested','canonical');

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'skills'
       AND policyname = 'skills_tenant_isolation'
  ) THEN
    CREATE POLICY skills_tenant_isolation ON skills
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. pending_threads — anti-amnesia checkpoint table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pending_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  user_id         text NOT NULL,
  thread_id       uuid NOT NULL,
  pending_kind    text NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  audit_hash      text NOT NULL DEFAULT '',
  CONSTRAINT pending_threads_kind_chk CHECK (pending_kind IN (
    'decision','approval','data_request','follow_up'
  ))
);

CREATE INDEX IF NOT EXISTS idx_pending_user
  ON pending_threads (tenant_id, user_id, resolved_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pending_thread
  ON pending_threads (tenant_id, thread_id, created_at DESC);

ALTER TABLE pending_threads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pending_threads'
       AND policyname = 'pending_threads_tenant_isolation'
  ) THEN
    CREATE POLICY pending_threads_tenant_isolation ON pending_threads
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 4. thread_summaries — MemGPT-style summarised turn-block records
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS thread_summaries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text NOT NULL,
  thread_id                uuid NOT NULL,
  summary_md               text NOT NULL,
  summarised_turn_range    int4range NOT NULL,
  token_count_original     int,
  token_count_summary      int,
  generated_at             timestamptz NOT NULL DEFAULT now(),
  audit_hash               text NOT NULL,
  CONSTRAINT thread_summary_token_positive CHECK (
    (token_count_original IS NULL OR token_count_original >= 0)
    AND (token_count_summary IS NULL OR token_count_summary >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_thread_summary
  ON thread_summaries (thread_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_summary_tenant
  ON thread_summaries (tenant_id, generated_at DESC);

ALTER TABLE thread_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'thread_summaries'
       AND policyname = 'thread_summaries_tenant_isolation'
  ) THEN
    CREATE POLICY thread_summaries_tenant_isolation ON thread_summaries
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
