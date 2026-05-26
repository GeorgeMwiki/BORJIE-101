-- ─────────────────────────────────────────────────────────────────────
-- Migration 0121 — Kernel memory hierarchy.
--
-- LITFIN-style four-tier memory ABOVE the existing `thread_events`
-- conversation transport. Gives the central-intelligence kernel the
-- persistent substrate it needs to remember and grow rather than just
-- react:
--
--   - kernel_memory_episodic   : concrete past events, per-(tenant,
--                                user), TTL-able. One row per
--                                user-message and per agent-action.
--   - kernel_memory_semantic   : extracted facts with confidence,
--                                evidence_count, source channel
--                                (extracted | declared | consolidated).
--                                NULL user_id = tenant-scope fact.
--   - kernel_memory_procedural : recurring tool-sequence patterns
--                                with invocations / successes counters
--                                so the kernel can rank suggestions
--                                by historical success rate.
--   - kernel_memory_reflective : periodic summaries (daily / weekly /
--                                monthly) written by the consolidation
--                                cycle agent. NULL user_id = tenant-
--                                wide rollup.
--
-- Idempotent: CREATE TYPE / TABLE / INDEX ... IF NOT EXISTS guards.
-- Re-running the migration on an existing schema is safe.
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE kernel_memory_episodic_kind AS ENUM (
    'user-message', 'agent-action', 'tool-result'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kernel_memory_semantic_source AS ENUM (
    'extracted', 'declared', 'consolidated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kernel_memory_reflective_period AS ENUM (
    'daily', 'weekly', 'monthly'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Episodic
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_memory_episodic (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  thread_id   TEXT NOT NULL,
  turn_id     TEXT NOT NULL,
  kind        kernel_memory_episodic_kind NOT NULL,
  summary     TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kernel_mem_episodic_tenant_user_time
  ON kernel_memory_episodic (tenant_id, user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_kernel_mem_episodic_thread
  ON kernel_memory_episodic (thread_id);

CREATE INDEX IF NOT EXISTS idx_kernel_mem_episodic_expires
  ON kernel_memory_episodic (expires_at);

-- ─────────────────────────────────────────────────────────────────────
-- Semantic — UNIQUE on (tenant_id, user_id, key) supports upserts.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_memory_semantic (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT,
  key             TEXT NOT NULL,
  value           JSONB NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0.5,
  source_turn_id  TEXT,
  evidence_count  INTEGER NOT NULL DEFAULT 1,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  source          kernel_memory_semantic_source NOT NULL DEFAULT 'extracted'
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_kernel_mem_semantic_tenant_user_key
  ON kernel_memory_semantic (tenant_id, user_id, key);

CREATE INDEX IF NOT EXISTS idx_kernel_mem_semantic_tenant_time
  ON kernel_memory_semantic (tenant_id, last_seen_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- Procedural
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_memory_procedural (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  pattern_name      TEXT NOT NULL,
  tool_sequence     JSONB NOT NULL DEFAULT '[]'::jsonb,
  trigger_keywords  JSONB NOT NULL DEFAULT '[]'::jsonb,
  invocations       INTEGER NOT NULL DEFAULT 0,
  successes         INTEGER NOT NULL DEFAULT 0,
  last_invoked_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_kernel_mem_procedural_tenant_user_pattern
  ON kernel_memory_procedural (tenant_id, user_id, pattern_name);

CREATE INDEX IF NOT EXISTS idx_kernel_mem_procedural_tenant_user
  ON kernel_memory_procedural (tenant_id, user_id);

-- ─────────────────────────────────────────────────────────────────────
-- Reflective
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_memory_reflective (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        TEXT,
  period_kind    kernel_memory_reflective_period NOT NULL,
  period_start   TIMESTAMPTZ NOT NULL,
  period_end     TIMESTAMPTZ NOT NULL,
  summary        TEXT NOT NULL,
  top_topics     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment_avg  REAL,
  action_items   JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_mem_reflective_tenant_user_period_start
  ON kernel_memory_reflective (tenant_id, user_id, period_kind, period_start DESC);

COMMENT ON TABLE kernel_memory_episodic IS
  'Concrete past events tied to (thread_id, turn_id). TTL-able. The kernel writes one row per user-message and one per agent-action; the consolidation cycle agent reads + purges expired rows.';

COMMENT ON TABLE kernel_memory_semantic IS
  'Extracted facts with confidence (0..1), evidence_count, and source channel. NULL user_id = tenant-scope fact. UNIQUE(tenant, user, key) supports idempotent upserts that bump evidence_count + last_seen_at.';

COMMENT ON TABLE kernel_memory_procedural IS
  'Recurring tool-sequence patterns the user invokes. invocations / successes drive the success-rate ranking the kernel uses to rank suggestions for matching triggers.';

COMMENT ON TABLE kernel_memory_reflective IS
  'Periodic (daily / weekly / monthly) summary digests written by the consolidation cycle agent. NULL user_id = tenant-wide rollup. Read-mixed into the kernel system prompt as "Recent reflection".';
