-- =============================================================================
-- Migration 0018 — Deep Research schema (Wave 17C)
--
-- Companion to docs/DESIGN/DEEP_RESEARCH_SPEC.md. Adds the persistence
-- substrate for Mr. Mwikila's SOTA agentic research engine across the 5
-- modes: Reactive Query, Anticipatory Sweep, Daily Briefing, Deep Dive,
-- Continuous Watch.
--
--   1. research_plans       — top-level plan (one per ResearchPlan).
--   2. research_steps       — ordered DAG of tool calls per plan.
--   3. research_artifacts   — typed retrieval artifacts with provenance
--                              + quality_score + bias_flags.
--   4. research_results     — synthesized output with span citations +
--                              audit-chain hash.
--   5. research_sessions    — long-running Deep Dive checkpointing.
--   6. continuous_watches   — owner-configured poll/threshold watches.
--
-- The plan/result FK loop is broken with a deferred-style ordering:
-- research_results carries plan_id (NOT NULL), and research_plans.result_id
-- (nullable) is added AFTER both tables exist via ALTER TABLE so the FK
-- can resolve forward.
--
-- All tenant-scoped tables RLS-enabled on `app.tenant_id` GUC. Idempotent.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. research_plans — top-level research plan
-- -----------------------------------------------------------------------------
-- `result_id` FK added later (see §7) once research_results exists.

CREATE TABLE IF NOT EXISTS research_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode              text NOT NULL,
  query             text NOT NULL,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  budget_ms         integer,
  budget_usd_cents  integer,
  spent_usd_cents   integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'planned',
  result_id         uuid,
  audit_hash        text,
  CONSTRAINT research_plans_mode_chk
    CHECK (mode IN (
      'reactive_query','anticipatory_sweep','daily_briefing',
      'deep_dive','continuous_watch'
    )),
  CONSTRAINT research_plans_status_chk
    CHECK (status IN ('planned','running','paused','complete','failed')),
  CONSTRAINT research_plans_created_by_chk
    CHECK (created_by IN ('mr_mwikila','owner_explicit','worker_cron'))
);

CREATE INDEX IF NOT EXISTS research_plans_tenant_status_mode_idx
  ON research_plans(tenant_id, status, mode);
CREATE INDEX IF NOT EXISTS research_plans_tenant_created_idx
  ON research_plans(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_plans_running_idx
  ON research_plans(tenant_id, created_at DESC)
  WHERE status IN ('running','paused');

-- -----------------------------------------------------------------------------
-- 2. research_steps — ordered tool calls within a plan
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  tool            text NOT NULL,
  tool_input      jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  started_at      timestamptz,
  finished_at     timestamptz,
  cost_usd_cents  integer,
  duration_ms     integer,
  error           text,
  CONSTRAINT research_steps_seq_unique UNIQUE (plan_id, seq),
  CONSTRAINT research_steps_tool_chk
    CHECK (tool IN (
      'web_search','web_fetch','corpus_query','commodity_price',
      'regulatory_diff','pdf_extract','image_ocr','table_parse',
      'news_scan','fx_rate'
    )),
  CONSTRAINT research_steps_status_chk
    CHECK (status IN ('pending','running','done','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS research_steps_plan_seq_idx
  ON research_steps(plan_id, seq);
CREATE INDEX IF NOT EXISTS research_steps_status_idx
  ON research_steps(plan_id, status);
CREATE INDEX IF NOT EXISTS research_steps_tool_idx
  ON research_steps(tool, status);

-- -----------------------------------------------------------------------------
-- 3. research_artifacts — typed retrieval artifacts with provenance
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_artifacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id             uuid NOT NULL REFERENCES research_steps(id) ON DELETE CASCADE,
  source_kind         text NOT NULL,
  source_uri          text NOT NULL,
  retrieved_at        timestamptz NOT NULL DEFAULT now(),
  content             text NOT NULL,
  extracted_entities  jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score       numeric(3,2),
  bias_flags          text[] NOT NULL DEFAULT ARRAY[]::text[],
  citation_id         text NOT NULL,
  CONSTRAINT research_artifacts_source_kind_chk
    CHECK (source_kind IN ('web','corpus','feed','pdf','image','table')),
  CONSTRAINT research_artifacts_quality_chk
    CHECK (quality_score IS NULL
      OR (quality_score >= 0 AND quality_score <= 1))
);

CREATE INDEX IF NOT EXISTS research_artifacts_step_idx
  ON research_artifacts(step_id);
CREATE INDEX IF NOT EXISTS research_artifacts_citation_idx
  ON research_artifacts(citation_id);
CREATE INDEX IF NOT EXISTS research_artifacts_source_kind_idx
  ON research_artifacts(source_kind);
CREATE INDEX IF NOT EXISTS research_artifacts_quality_idx
  ON research_artifacts(quality_score DESC NULLS LAST);

-- -----------------------------------------------------------------------------
-- 4. research_results — synthesized output with span citations + audit hash
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
  summary_md      text NOT NULL,
  span_citations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence      text NOT NULL,
  disagreements   jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_hash      text NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_results_confidence_chk
    CHECK (confidence IN ('high','medium','low'))
);

CREATE INDEX IF NOT EXISTS research_results_plan_idx
  ON research_results(plan_id);
CREATE INDEX IF NOT EXISTS research_results_generated_idx
  ON research_results(generated_at DESC);
CREATE INDEX IF NOT EXISTS research_results_confidence_idx
  ON research_results(confidence);

-- -----------------------------------------------------------------------------
-- 5. research_sessions — long-running Deep Dive checkpointing
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_sessions (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic                           text NOT NULL,
  active_plan_id                  uuid REFERENCES research_plans(id) ON DELETE SET NULL,
  state                           jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at                      timestamptz NOT NULL DEFAULT now(),
  last_progress_at                timestamptz NOT NULL DEFAULT now(),
  status                          text NOT NULL DEFAULT 'running',
  owner_sign_off_required_at_usd  numeric[] NOT NULL DEFAULT ARRAY[]::numeric[],
  CONSTRAINT research_sessions_status_chk
    CHECK (status IN ('running','paused','complete','failed'))
);

CREATE INDEX IF NOT EXISTS research_sessions_tenant_status_idx
  ON research_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS research_sessions_active_plan_idx
  ON research_sessions(active_plan_id);
CREATE INDEX IF NOT EXISTS research_sessions_last_progress_idx
  ON research_sessions(tenant_id, last_progress_at DESC);

-- -----------------------------------------------------------------------------
-- 6. continuous_watches — owner-configured poll/threshold watches
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS continuous_watches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic             text NOT NULL,
  cadence_minutes   integer NOT NULL,
  last_run_at       timestamptz,
  next_run_at       timestamptz,
  thresholds        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT continuous_watches_status_chk
    CHECK (status IN ('active','paused','expired','deleted')),
  CONSTRAINT continuous_watches_cadence_chk
    CHECK (cadence_minutes >= 1)
);

CREATE INDEX IF NOT EXISTS continuous_watches_tenant_status_idx
  ON continuous_watches(tenant_id, status);
CREATE INDEX IF NOT EXISTS continuous_watches_due_idx
  ON continuous_watches(next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS continuous_watches_creator_idx
  ON continuous_watches(created_by_user_id);

-- -----------------------------------------------------------------------------
-- 7. Wire the deferred FK research_plans.result_id → research_results(id)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'research_plans_result_id_fkey'
  ) THEN
    ALTER TABLE research_plans
      ADD CONSTRAINT research_plans_result_id_fkey
      FOREIGN KEY (result_id)
      REFERENCES research_results(id)
      ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS research_plans_result_idx
  ON research_plans(result_id)
  WHERE result_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security — tenant-scoped tables. research_steps,
--    research_artifacts, research_results inherit isolation via FK to
--    research_plans/steps; we also enable RLS on them with a parent-row
--    policy via the plan_id → research_plans.tenant_id linkage.
--    To keep this simple + fast + non-CTE, we enforce tenant isolation
--    on the *parent* table (research_plans) and rely on FK CASCADE +
--    application-layer JOIN-time tenant filtering for children. This
--    matches the existing pattern in migration 0003 where licence_events
--    is tenant-scoped via its own tenant_id column AND the parent FK.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'research_plans',
    'research_sessions',
    'continuous_watches'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

-- research_steps / research_artifacts / research_results don't carry
-- tenant_id directly — they inherit through plan_id. Enable RLS with a
-- subquery policy so a row is visible iff its parent plan is visible
-- under the current tenant GUC.

ALTER TABLE research_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON research_steps;
CREATE POLICY tenant_isolation ON research_steps
  USING (
    plan_id IN (
      SELECT id FROM research_plans
      WHERE tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE research_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON research_artifacts;
CREATE POLICY tenant_isolation ON research_artifacts
  USING (
    step_id IN (
      SELECT s.id FROM research_steps s
      JOIN research_plans p ON s.plan_id = p.id
      WHERE p.tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE research_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON research_results;
CREATE POLICY tenant_isolation ON research_results
  USING (
    plan_id IN (
      SELECT id FROM research_plans
      WHERE tenant_id = current_setting('app.tenant_id', true)
    )
  );

COMMIT;

-- =============================================================================
-- End of migration 0018_deep_research.sql
-- =============================================================================
