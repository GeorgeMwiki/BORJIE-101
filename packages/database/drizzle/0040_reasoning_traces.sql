-- =============================================================================
-- Migration 0040 — Reasoning Traces + PRM Training Examples + MCTS Tree Dumps
--
-- Companion to Docs/DESIGN/PRM_MCTS_REASONING_SPEC.md and
-- packages/process-reward-model. Adds the three durable tables backing
-- the search-based reasoning engine (P0 #1 closure from the 18BB gap
-- analysis):
--
--   1. reasoning_traces       — one row per (kernel-turn × trajectory)
--                               capture. Stores intent, trajectory_jsonb,
--                               outcome label (NULL until verified by
--                               regulator portal / payment / human),
--                               and audit hash. Tenant-scoped, RLS.
--
--   2. prm_training_examples  — one row per (state, step, label) pair
--                               derived from labeled traces by the
--                               Math-Shepherd completer technique.
--                               Tenant-scoped, RLS, FK-linked to the
--                               source trace.
--
--   3. mcts_search_tree_dumps — one row per MCTS invocation. Stores the
--                               root intent, the (capped) tree as
--                               jsonb, the budget snapshot, the
--                               selected path, the termination reason,
--                               and wall-clock. Tenant-scoped, RLS.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. reasoning_traces — full trajectory captures (anti-PRM-training seed)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reasoning_traces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  session_id      text NOT NULL,
  turn_id         text NOT NULL,
  intent_kind     text NOT NULL,
  trajectory_jsonb jsonb NOT NULL,
  outcome_label   smallint,
  outcome_source  text,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  labeled_at      timestamptz,
  audit_hash      text NOT NULL,
  CONSTRAINT reasoning_traces_outcome_label_range
    CHECK (outcome_label IS NULL OR outcome_label IN (0, 1)),
  CONSTRAINT reasoning_traces_outcome_source_kind
    CHECK (
      outcome_source IS NULL
      OR outcome_source IN ('regulator_portal', 'payment', 'human')
    )
);

CREATE INDEX IF NOT EXISTS idx_reasoning_traces_tenant_recent
  ON reasoning_traces (tenant_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_reasoning_traces_intent_label
  ON reasoning_traces (intent_kind, outcome_label);

CREATE INDEX IF NOT EXISTS idx_reasoning_traces_turn
  ON reasoning_traces (tenant_id, turn_id);

ALTER TABLE reasoning_traces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'reasoning_traces'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON reasoning_traces
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. prm_training_examples — labeled (state, step) pairs for the learned PRM
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prm_training_examples (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text NOT NULL,
  trace_id                    uuid NOT NULL,
  state_jsonb                 jsonb NOT NULL,
  step_jsonb                  jsonb NOT NULL,
  label                       smallint NOT NULL,
  completer_agreement_ratio   double precision NOT NULL,
  derived_at                  timestamptz NOT NULL DEFAULT now(),
  audit_hash                  text NOT NULL,
  CONSTRAINT prm_training_examples_label_range
    CHECK (label IN (0, 1)),
  CONSTRAINT prm_training_examples_ratio_range
    CHECK (completer_agreement_ratio >= 0 AND completer_agreement_ratio <= 1),
  CONSTRAINT prm_training_examples_trace_fk
    FOREIGN KEY (trace_id) REFERENCES reasoning_traces (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prm_training_examples_tenant_recent
  ON prm_training_examples (tenant_id, derived_at DESC);

CREATE INDEX IF NOT EXISTS idx_prm_training_examples_trace
  ON prm_training_examples (trace_id);

CREATE INDEX IF NOT EXISTS idx_prm_training_examples_label
  ON prm_training_examples (tenant_id, label);

ALTER TABLE prm_training_examples ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'prm_training_examples'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON prm_training_examples
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. mcts_search_tree_dumps — per-invocation audit + replay store
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcts_search_tree_dumps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL,
  turn_id              text NOT NULL,
  root_intent_jsonb    jsonb NOT NULL,
  tree_jsonb           jsonb NOT NULL,
  budget_jsonb         jsonb NOT NULL,
  selected_path_jsonb  jsonb NOT NULL,
  terminated_reason    text NOT NULL,
  wall_ms              integer NOT NULL,
  rollouts_run         integer NOT NULL,
  best_value           double precision NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  audit_hash           text NOT NULL,
  CONSTRAINT mcts_search_tree_dumps_terminated_kind
    CHECK (
      terminated_reason IN (
        'budget_exhausted',
        'confident_root_choice',
        'wall_clock_exceeded',
        'no_expansion_possible'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_mcts_search_tree_dumps_tenant_recent
  ON mcts_search_tree_dumps (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcts_search_tree_dumps_turn
  ON mcts_search_tree_dumps (tenant_id, turn_id);

CREATE INDEX IF NOT EXISTS idx_mcts_search_tree_dumps_terminated
  ON mcts_search_tree_dumps (terminated_reason);

ALTER TABLE mcts_search_tree_dumps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'mcts_search_tree_dumps'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON mcts_search_tree_dumps
      USING (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END;
$$;

COMMIT;
