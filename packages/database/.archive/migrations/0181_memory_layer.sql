-- ─────────────────────────────────────────────────────────────────────
-- Migration 0181 — Persistent memory layer.
--
-- Closes the LITFIN parity gap that the kernel memory ports
-- (`packages/central-intelligence/src/kernel/memory/types.ts`) have
-- documented for two cycles but never had a backing schema for.
-- Three tables, all tenant-scoped, all RLS-protected:
--
--   1. memory_blocks    — Letta-style per-(tenant, session) durable
--                         blocks with a `kind` discriminator. Read at
--                         every turn, re-injected at the top of the
--                         system prompt; rewritten by the consolidation
--                         cycle.
--   2. episodic_notes   — A-Mem (Agent-Memory) style note ledger with
--                         importance score, vector embedding (TEXT JSON
--                         to stay pgvector-optional), per-note parents
--                         array, FadeMem access counters for the LFU
--                         decay side.
--   3. anchor_summaries — window-anchored summarisations written when
--                         the conversation window approaches ~70% of
--                         the model's context budget.
--
-- Embeddings stored as TEXT so the schema is portable to managed
-- Postgres without pgvector. Migration 0178 pre-installs pgvector
-- conditionally; adapters cast at read time when available.
--
-- Idempotent — all `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY`
-- statements use `IF NOT EXISTS` (or DROP-then-CREATE inside DO/EXCEPTION
-- blocks for policies, which Postgres has no `IF NOT EXISTS` form for).
-- ─────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. memory_blocks
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_blocks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL,
  /** 'persona' | 'human' | 'preferences' | 'project' | ... */
  kind                TEXT NOT NULL,
  content             TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_blocks_tenant_session_kind
  ON memory_blocks (tenant_id, session_id, kind);

CREATE INDEX IF NOT EXISTS idx_memory_blocks_tenant_session_updated
  ON memory_blocks (tenant_id, session_id, updated_at DESC);

COMMENT ON TABLE memory_blocks IS
  'Persistent per-(tenant, session) self-summary blocks (Letta-style). Read at every turn, injected at the top of the system prompt.';

-- ============================================================================
-- 2. episodic_notes
-- ============================================================================

CREATE TABLE IF NOT EXISTS episodic_notes (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL,
  turn_idx            INTEGER NOT NULL,
  event               JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Atomic facts extracted from the event; joined for FTS. */
  facts               JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** JSON-encoded number array; TEXT to stay pgvector-optional. */
  embedding           TEXT,
  /** FadeMem importance in [0, 1]. */
  importance_score    DOUBLE PRECISION NOT NULL DEFAULT 0.4,
  /** IDs of related notes linked at cosine >= 0.8. */
  parents             JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** LFU read-count for the eviction effective-score. */
  access_count        INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Soft-delete marker; hard-deleted 90 days later by the eviction sweep. */
  soft_deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_episodic_notes_tenant_session_turn
  ON episodic_notes (tenant_id, session_id, turn_idx);

CREATE INDEX IF NOT EXISTS idx_episodic_notes_tenant_created
  ON episodic_notes (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_episodic_notes_soft_deleted
  ON episodic_notes (soft_deleted_at);

-- Full-text search over the JSON-array `facts`. We coerce to TEXT
-- so the GIN index works on any Postgres without language-specific
-- tsvector configuration.
CREATE INDEX IF NOT EXISTS idx_episodic_notes_facts_fts
  ON episodic_notes
  USING gin (to_tsvector('simple', facts::text));

COMMENT ON TABLE episodic_notes IS
  'A-Mem (Agent-Memory) per-event note ledger. Importance scored on write; FadeMem decay applied at sweep time; soft-deleted at score < 0.1; hard-evicted 90 days later.';

-- ============================================================================
-- 3. anchor_summaries
-- ============================================================================

CREATE TABLE IF NOT EXISTS anchor_summaries (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL,
  start_turn_idx      INTEGER NOT NULL,
  end_turn_idx        INTEGER NOT NULL,
  summary             TEXT NOT NULL,
  original_tokens     INTEGER NOT NULL DEFAULT 0,
  summary_tokens      INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_summaries_tenant_session_range
  ON anchor_summaries (tenant_id, session_id, start_turn_idx, end_turn_idx);

CREATE INDEX IF NOT EXISTS idx_anchor_summaries_tenant_session_created
  ON anchor_summaries (tenant_id, session_id, created_at DESC);

COMMENT ON TABLE anchor_summaries IS
  'Conversation window condensations written when prompt approaches ~70% context budget. Re-injected as a single bullet block instead of the full earlier-turn transcript.';

-- ============================================================================
-- 4. Row-level security — tenant isolation via `app.current_tenant_id`
--    GUC. See migration 0172 for the canonical helper
--    `public.current_app_tenant_id()` that reads this GUC with a
--    legacy `app.tenant_id` fallback.
-- ============================================================================

ALTER TABLE IF EXISTS memory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS memory_blocks FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS episodic_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS episodic_notes FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS anchor_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS anchor_summaries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'memory_blocks') THEN
    DROP POLICY IF EXISTS memory_blocks_tenant_isolation ON memory_blocks;
    CREATE POLICY memory_blocks_tenant_isolation ON memory_blocks
      USING (
        tenant_id IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS memory_blocks_tenant_isolation_write ON memory_blocks;
    CREATE POLICY memory_blocks_tenant_isolation_write ON memory_blocks
      FOR INSERT
      WITH CHECK (
        tenant_id IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'episodic_notes') THEN
    DROP POLICY IF EXISTS episodic_notes_tenant_isolation ON episodic_notes;
    CREATE POLICY episodic_notes_tenant_isolation ON episodic_notes
      USING (
        tenant_id IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS episodic_notes_tenant_isolation_write ON episodic_notes;
    CREATE POLICY episodic_notes_tenant_isolation_write ON episodic_notes
      FOR INSERT
      WITH CHECK (
        tenant_id IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'anchor_summaries') THEN
    DROP POLICY IF EXISTS anchor_summaries_tenant_isolation ON anchor_summaries;
    CREATE POLICY anchor_summaries_tenant_isolation ON anchor_summaries
      USING (
        tenant_id IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS anchor_summaries_tenant_isolation_write ON anchor_summaries;
    CREATE POLICY anchor_summaries_tenant_isolation_write ON anchor_summaries
      FOR INSERT
      WITH CHECK (
        tenant_id IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
