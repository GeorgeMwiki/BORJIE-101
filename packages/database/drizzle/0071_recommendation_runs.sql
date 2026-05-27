-- =============================================================================
-- Migration 0071 — Recommendation Runs (SOTA-RECO wave)
--
-- Companion to Docs/DESIGN/RECOMMENDATIONS_SOTA_2026.md and the
-- @borjie/recommendations package (packages/recommendations/).
--
-- Persona: Mr. Mwikila. He matches buyers to mines, workers to sites,
-- regulators to filings, suppliers to operators, and training courses
-- to workers. Every match is persisted so the operator can replay the
-- exact ranking that justified flying a buyer to a pit, rostering a
-- worker onto a shift, opening a regulatory filing review, shipping a
-- drill bit, or enrolling a worker in a certification refresh.
--
-- Two tables:
--
--   recommendation_runs      — one row per persisted ranking. Carries
--                              the candidate set, the top-K item list,
--                              the per-item scores, the algorithm tag,
--                              and a PO-14 audit-chain link so a
--                              tenant's recommendation history is
--                              tamper-evident.
--
--   recommendation_feedback  — one row per (run, item, signal) tuple.
--                              Signals: click | dismiss | convert |
--                              rate. Fed back into the bandit posterior
--                              and the LLM reranker's prompt history.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- recommendation_runs — every persisted ranking Mr. Mwikila produces
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  /** Match target. One of:
        'buyer_mine'             — buyer matched to producing pit
        'worker_site'            — worker matched to site / shift
        'regulator_filing'       — regulator routed to filing
        'supplier_mine'          — supplier matched to pit
        'course_worker'          — training-course matched to worker
  */
  target           text NOT NULL,
  /** Algorithm tag. Singletons: 'popularity' | 'content_based' |
      'user_user_cf' | 'item_item_cf' | 'matrix_factorization' |
      'llm_rerank' | 'two_tower' | 'thompson_sampling' | 'linucb' |
      'coldstart_router'. Ensembles: 'ensemble:<spec>' where <spec>
      is the sorted, comma-separated set of constituents. */
  algorithm        text NOT NULL,
  /** Full candidate pool (item ids). JSON array of strings. */
  candidates       jsonb NOT NULL,
  /** Top-K item list — JSON array of item ids, ordered. */
  top_k_items      jsonb NOT NULL,
  /** Per-item scores. Shape:
        [{ "itemId": "...", "score": 0.83, "reason": "..." }, ...] */
  scores           jsonb NOT NULL,
  served_at        timestamptz NOT NULL DEFAULT now(),
  /** PO-14 audit chain. */
  prev_hash        text NOT NULL DEFAULT '',
  audit_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_runs_target_chk'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_target_chk
      CHECK (target IN (
        'buyer_mine',
        'worker_site',
        'regulator_filing',
        'supplier_mine',
        'course_worker'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_runs_algorithm_nonempty_chk'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_algorithm_nonempty_chk
      CHECK (length(algorithm) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_runs_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_runs_candidates_is_array_chk'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_candidates_is_array_chk
      CHECK (jsonb_typeof(candidates) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_runs_top_k_is_array_chk'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_top_k_is_array_chk
      CHECK (jsonb_typeof(top_k_items) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_runs_scores_is_array_chk'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT recommendation_runs_scores_is_array_chk
      CHECK (jsonb_typeof(scores) = 'array');
  END IF;
END $$;

-- Hot path: list a tenant's recent runs for a given target.
CREATE INDEX IF NOT EXISTS idx_recommendation_runs_tenant_target_served
  ON recommendation_runs (tenant_id, target, served_at DESC);

-- Algorithm-comparison path: filter by algorithm within a tenant.
CREATE INDEX IF NOT EXISTS idx_recommendation_runs_tenant_algorithm
  ON recommendation_runs (tenant_id, algorithm);

-- Forensic replay path.
CREATE INDEX IF NOT EXISTS idx_recommendation_runs_audit_hash
  ON recommendation_runs (audit_hash);

ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'recommendation_runs'
       AND policyname = 'recommendation_runs_tenant_isolation'
  ) THEN
    CREATE POLICY recommendation_runs_tenant_isolation
      ON recommendation_runs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- recommendation_feedback — click / dismiss / convert / rate signals
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL,
  item_id          text NOT NULL,
  /** Feedback signal. */
  signal           text NOT NULL,
  /** Numeric value bound to the signal. For 'rate': 0..5. For
      'click' / 'dismiss' / 'convert': 0 or 1. */
  value            numeric NOT NULL DEFAULT 0,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  /** PO-14 audit chain — feedback is also tamper-evident. */
  audit_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_feedback_signal_chk'
  ) THEN
    ALTER TABLE recommendation_feedback
      ADD CONSTRAINT recommendation_feedback_signal_chk
      CHECK (signal IN ('click', 'dismiss', 'convert', 'rate'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_feedback_item_nonempty_chk'
  ) THEN
    ALTER TABLE recommendation_feedback
      ADD CONSTRAINT recommendation_feedback_item_nonempty_chk
      CHECK (length(item_id) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_feedback_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE recommendation_feedback
      ADD CONSTRAINT recommendation_feedback_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recommendation_feedback_value_bounds_chk'
  ) THEN
    ALTER TABLE recommendation_feedback
      ADD CONSTRAINT recommendation_feedback_value_bounds_chk
      CHECK (value >= 0 AND value <= 5);
  END IF;
END $$;

-- Hot path: pull a run's feedback in recorded order.
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_run_recorded
  ON recommendation_feedback (run_id, recorded_at DESC);

-- Bandit-update path: select a tenant's recent feedback for a user.
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_user_recorded
  ON recommendation_feedback (user_id, recorded_at DESC);

ALTER TABLE recommendation_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'recommendation_feedback'
       AND policyname = 'recommendation_feedback_tenant_isolation'
  ) THEN
    CREATE POLICY recommendation_feedback_tenant_isolation
      ON recommendation_feedback
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
            FROM recommendation_runs r
           WHERE r.id = recommendation_feedback.run_id
             AND r.tenant_id = current_setting('app.tenant_id', true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
            FROM recommendation_runs r
           WHERE r.id = recommendation_feedback.run_id
             AND r.tenant_id = current_setting('app.tenant_id', true)
        )
      );
  END IF;
END $$;

COMMIT;
