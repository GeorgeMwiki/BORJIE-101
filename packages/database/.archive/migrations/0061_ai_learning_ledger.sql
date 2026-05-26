-- =============================================================================
-- 0061: AI Learning Ledger — Wave-12 (continuous + adaptive + micro learning)
-- =============================================================================
-- Lifetime learning ledger per user, style profiles, and per-concept progress.
-- Feeds the Adaptive Learner, Continuous Learning Store, and Micro-Learning
-- Engine. Append-only for the session/event ledger; mutable for the style
-- profile and progress snapshot (kept small, recomputed from ledger).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_learning_sessions (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  concept_id        TEXT,
  event             TEXT NOT NULL,
  ts                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_sessions_tenant_user
  ON ai_learning_sessions(tenant_id, user_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_learning_sessions_concept
  ON ai_learning_sessions(tenant_id, concept_id, ts DESC)
  WHERE concept_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_learning_progress (
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  concept_id        TEXT NOT NULL,
  p_know            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  observations      INTEGER NOT NULL DEFAULT 0,
  mastered_at       TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_progress_user
  ON ai_learning_progress(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS ai_learning_style_profiles (
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  visual_score      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  verbal_score      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  hands_on_score    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  dominant_style    TEXT NOT NULL DEFAULT 'mixed'
                      CHECK (dominant_style IN ('visual','verbal','hands-on','mixed')),
  sample_size       INTEGER NOT NULL DEFAULT 0,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);
