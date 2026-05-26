-- =============================================================================
-- 0045: AI Classroom — Bayesian Knowledge Tracing for staff training — Wave 11
-- =============================================================================
-- BORJIE's AI Professor sub-persona trains estate-management employees
-- via live group sessions with BKT-tracked mastery per concept per learner.
--
-- Tables:
--   classroom_sessions          — a single session (instructor + N learners)
--   classroom_participants      — session roster
--   classroom_quizzes           — generated questions per session
--   classroom_quiz_responses    — learner answers, feeds BKT update
--   bkt_mastery                 — per learner + concept mastery snapshot
-- =============================================================================

CREATE TABLE IF NOT EXISTS classroom_sessions (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  created_by           TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','active','paused','ended')),
  language             TEXT NOT NULL DEFAULT 'mixed' CHECK (language IN ('en','sw','mixed')),
  target_concept_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  covered_concept_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_classroom_sessions_tenant
  ON classroom_sessions(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_participants (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES classroom_sessions(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('instructor','learner','ai_professor')),
  is_present        BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at           TIMESTAMPTZ,
  correct_answers   INTEGER NOT NULL DEFAULT 0,
  total_answers     INTEGER NOT NULL DEFAULT 0,
  last_answer_at    TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_participants_tenant
  ON classroom_participants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_classroom_participants_user
  ON classroom_participants(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS classroom_quizzes (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES classroom_sessions(id) ON DELETE CASCADE,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  concept_id       TEXT NOT NULL,
  question_text    TEXT NOT NULL,
  choices          JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_index    INTEGER,
  rationale        TEXT,
  difficulty       TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  bloom_level      TEXT NOT NULL DEFAULT 'apply',
  language         TEXT NOT NULL DEFAULT 'en',
  generated_by     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classroom_quizzes_session
  ON classroom_quizzes(tenant_id, session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_quiz_responses (
  id               TEXT PRIMARY KEY,
  quiz_id          TEXT NOT NULL REFERENCES classroom_quizzes(id) ON DELETE CASCADE,
  session_id       TEXT NOT NULL REFERENCES classroom_sessions(id) ON DELETE CASCADE,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL,
  concept_id       TEXT NOT NULL,
  answer_text      TEXT,
  answer_index     INTEGER,
  is_correct       BOOLEAN NOT NULL,
  latency_ms       INTEGER,
  answered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classroom_quiz_responses_session
  ON classroom_quiz_responses(tenant_id, session_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_classroom_quiz_responses_user
  ON classroom_quiz_responses(tenant_id, user_id, concept_id);

CREATE TABLE IF NOT EXISTS bkt_mastery (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL,
  concept_id       TEXT NOT NULL,
  p_know           DOUBLE PRECISION NOT NULL DEFAULT 0.1
    CHECK (p_know >= 0 AND p_know <= 1),
  p_learn          DOUBLE PRECISION NOT NULL DEFAULT 0.2
    CHECK (p_learn >= 0 AND p_learn <= 1),
  p_slip           DOUBLE PRECISION NOT NULL DEFAULT 0.1
    CHECK (p_slip >= 0 AND p_slip <= 1),
  p_guess          DOUBLE PRECISION NOT NULL DEFAULT 0.2
    CHECK (p_guess >= 0 AND p_guess <= 1),
  observations     INTEGER NOT NULL DEFAULT 0 CHECK (observations >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_bkt_mastery_user_concept
  ON bkt_mastery(tenant_id, user_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_bkt_mastery_tenant_concept
  ON bkt_mastery(tenant_id, concept_id);
