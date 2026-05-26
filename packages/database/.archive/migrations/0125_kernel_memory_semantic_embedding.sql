-- ─────────────────────────────────────────────────────────────────────
-- Migration 0125 — Kernel memory semantic: embedding column for query-
-- conditioned retrieval (LITFIN parity — gap C in
-- `.planning/parity-litfin/02-memory-learning.md`).
--
-- Before this migration the kernel's `loadSemanticFacts` call site
-- fetches the most-recently-touched N facts regardless of topic, so
-- the system prompt was polluted with irrelevant context every turn.
-- After this migration, the consolidation cycle generates a 1536-dim
-- embedding (OpenAI `text-embedding-3-small` — matches the LITFIN
-- reference's `match_ai_semantic_facts` RPC) at fact-upsert time and
-- the kernel reads via `searchByEmbedding(tenantId, queryEmbedding, k)`
-- using pgvector's `<=>` cosine distance.
--
-- The column is nullable: rows written before this migration keep
-- `embedding = NULL`. The read path filters NULL embeddings out so
-- old facts degrade gracefully (they are still reachable via the
-- existing recency-ordered `search(...)` path).
--
-- Idempotent: extension + column + index guards. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- pgvector — provides the `vector(N)` column type and the `<=>`
-- cosine-distance operator used by `searchByEmbedding`. Postgres 14+
-- supports the extension with the `pgvector` package installed on the
-- server. The CREATE EXTENSION is IF NOT EXISTS so re-runs are safe.
-- Wrapped in a DO/EXCEPTION block so apply-check against a stock
-- Postgres image (which does not ship pgvector) emits a NOTICE rather
-- than aborting the whole migration chain. Downstream ALTERs/INDEXes
-- that depend on `vector(...)` will surface the real error if and only
-- if the extension is actually missing at runtime — fail-loud locally,
-- skip-loud in apply-check.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '0125: pgvector unavailable: %', SQLERRM;
END $$;

-- Add the embedding column. text-embedding-3-small returns 1536-dim
-- vectors; the dimensionality is fixed at column-create time and
-- enforced by pgvector on insert.
ALTER TABLE kernel_memory_semantic
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- IVFFLAT index for cosine-distance ANN search. `lists = 100` is a
-- reasonable starting point for tens-of-thousands of facts per tenant;
-- can be tuned later. `WITH (lists = …)` requires the table to be
-- non-empty for build-time training, so we use a partial-index guard
-- that skips NULL embeddings — the index has zero entries on a fresh
-- migration and grows as the consolidation cycle backfills.
--
-- Use the simpler unique-condition approach: build the index only over
-- non-null embeddings so the index is empty on initial migration and
-- pgvector skips the warm-up training step.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'kernel_memory_semantic'
      AND indexname = 'idx_kernel_mem_semantic_embedding_cos'
  ) THEN
    EXECUTE 'CREATE INDEX idx_kernel_mem_semantic_embedding_cos
             ON kernel_memory_semantic
             USING ivfflat (embedding vector_cosine_ops)
             WITH (lists = 100)
             WHERE embedding IS NOT NULL';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- ivfflat requires non-empty training data on some pgvector builds;
  -- if the index build fails (empty table or version mismatch), fall
  -- back to a sequential-scan plan. The read path still works — it is
  -- just slower until a CREATE INDEX CONCURRENTLY is re-run after the
  -- consolidation cycle backfills enough embeddings.
  RAISE NOTICE 'idx_kernel_mem_semantic_embedding_cos build deferred: %', SQLERRM;
END $$;

COMMENT ON COLUMN kernel_memory_semantic.embedding IS
  'OpenAI text-embedding-3-small (1536 dims). NULL for rows written before migration 0125 or when the consolidation cycle ran without an embedding port. Read via searchByEmbedding(tenantId, queryEmbedding, k) using pgvector <=> cosine distance.';
