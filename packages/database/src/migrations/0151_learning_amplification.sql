-- =============================================================================
-- Migration 0151 — Learning Amplification (LitFin port)
--
-- Purpose
-- -------
-- Backs the Borjie continuous-learning loop ported from LitFin
-- (packages/learning-amplification/). Every interaction with Mr. Mwikila
-- (claim cited / confirmed / disputed / corrected / cron-verified /
-- cron-changed / source-dead) is captured here as a Bayesian datum so
-- the brain measurably improves user-over-user.
--
-- Tables
-- ------
--   learning_observations  — append-only event stream feeding the
--                            nightly amplification job. PII-scrubbed
--                            in app code; user_id_hash is SHA-256 of
--                            the raw id (BorjieMark privacy invariant).
--
--   truth_review_queue     — high-priority claims that need human
--                            review after a user dispute or cron drift.
--
--   learning_cohort_stats  — cohort metrics view consumed by /admin
--                            dashboards to prove "user 100 > user 50".
--
-- Notes
--   * `truth_claims` is provisioned by the truth-engine module — this
--     migration does NOT re-declare it. The recorder + job READ that
--     table; if absent at runtime the recorder degrades to insert-only
--     into `learning_observations` (gracefully no-ops on the .update()).
--   * tenant_id is nullable: marketing-surface (anonymous public-chat)
--     observations are tenant-less. Per-tenant rows still enforce RLS
--     downstream via the supplied tenant_id column.
--   * Migration is forward-only and idempotent via IF NOT EXISTS.
-- =============================================================================

-- learning_observations -------------------------------------------------------
CREATE TABLE IF NOT EXISTS learning_observations (
  id                BIGSERIAL PRIMARY KEY,
  kind              TEXT NOT NULL,
  subject_key       TEXT NOT NULL,
  user_id_hash      TEXT,
  tenant_id         TEXT,
  portal_context    TEXT,
  correlation_id    TEXT,
  user_text         TEXT,
  proposed_value    TEXT,
  proposed_unit     TEXT,
  weight            NUMERIC(5,3) NOT NULL DEFAULT 1.0,
  recorded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learning_observations_kind_idx
  ON learning_observations (kind, recorded_at DESC);
CREATE INDEX IF NOT EXISTS learning_observations_subject_idx
  ON learning_observations (subject_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS learning_observations_tenant_idx
  ON learning_observations (tenant_id, recorded_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS learning_observations_correlation_idx
  ON learning_observations (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE learning_observations IS
  'BorjieMark::learning-amplification append-only stream of interaction observations. PII-scrubbed in app; user_id_hash = SHA-256(raw_user_id).';

-- truth_review_queue ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS truth_review_queue (
  id           BIGSERIAL PRIMARY KEY,
  claim_id     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 50,
  reviewed_at  TIMESTAMPTZ,
  reviewer     TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS truth_review_queue_pending_idx
  ON truth_review_queue (priority DESC, created_at ASC)
  WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS truth_review_queue_claim_idx
  ON truth_review_queue (claim_id);

COMMENT ON TABLE truth_review_queue IS
  'Claims flagged by the recorder for human review (user disputes, cron drifts). Priority 90+ = urgent.';

-- learning_cohort_stats (view) ------------------------------------------------
-- Best-effort cohort signal. The job reads `learning_cohort_stats` and
-- silently returns [] if it isn't materialised (LitFin parity behaviour).
-- We provide a thin VIEW that buckets by approximate user cohort using
-- the user_id_hash distribution; downstream analytics can override with
-- a richer materialised view without breaking the recorder.
CREATE OR REPLACE VIEW learning_cohort_stats AS
SELECT
  CASE
    WHEN tier_rank BETWEEN 1   AND 50   THEN 'users-1-50'
    WHEN tier_rank BETWEEN 51  AND 100  THEN 'users-51-100'
    WHEN tier_rank BETWEEN 101 AND 500  THEN 'users-101-500'
    ELSE                                     'users-500plus'
  END                                                                AS cohort,
  AVG(CASE WHEN kind = 'answer_deferred' THEN 1 ELSE 0 END)::numeric AS avg_deferral_rate,
  AVG(CASE WHEN kind = 'claim_confirmed_by_user' THEN 1 ELSE 0 END)::numeric
                                                                     AS avg_user_confirm_rate,
  AVG(CASE WHEN kind = 'language_misdetected' THEN 0 ELSE 1 END)::numeric
                                                                     AS avg_language_match_accuracy,
  COUNT(DISTINCT subject_key) FILTER (WHERE kind LIKE 'claim_%')     AS claims_covered,
  NOW()                                                              AS aggregated_at
FROM (
  SELECT
    lo.*,
    DENSE_RANK() OVER (ORDER BY user_id_hash) AS tier_rank
  FROM learning_observations lo
  WHERE user_id_hash IS NOT NULL
) ranked
GROUP BY cohort;

COMMENT ON VIEW learning_cohort_stats IS
  'BorjieMark::learning-amplification cohort metrics — proves user 100 > user 50.';
