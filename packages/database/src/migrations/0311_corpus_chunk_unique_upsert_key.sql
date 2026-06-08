-- =============================================================================
-- Migration 0311 — make the corpus upsert key REAL (KI-05 / KI-06 / KI-13)
--                  + assert the cosine ANN index (KI-08 alignment).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The first-boot corpus-ingest worker
-- (services/consolidation-worker/src/tasks/borjie-corpus-adapters.ts and the
-- raw-SQL variant in borjie-corpus-cli-direct.ts) upserts every chunk with
-- `INSERT ... ON CONFLICT (...) DO UPDATE`. The Drizzle schema declares
-- `intelligence_corpus_chunks_source_section_uniq` as a `uniqueIndex(...)`,
-- but NO migration ever created a UNIQUE index — the base baseline
-- (drizzle/0003_mining_domain.sql:965) shipped only a NON-UNIQUE index on
-- `(source_file, section)`. So the production `ON CONFLICT` clause had no
-- matching arbiter index and would ERROR ("no unique or exclusion constraint
-- matching the ON CONFLICT specification"), which silently aborted the ingest
-- transaction — a structural reason the global corpus stayed empty (KI-05).
--
-- Two further defects fold in here:
--   - KI-06: `section` is NULLable. A plain UNIQUE index on `(source_file,
--            section)` does NOT dedupe rows whose `section IS NULL` (every
--            NULL is distinct in a standard B-tree unique index), so the
--            __preamble__/unsectioned chunks would pile up duplicates.
--   - KI-13: the OCR tenant-ingest path
--            (ocr-extraction-task.ts) writes tenant-scoped rows. A conflict
--            key WITHOUT `tenant_id` would collapse two different tenants'
--            same-named source files onto one row (cross-tenant bleed) OR
--            collide a tenant row with a global (tenant_id IS NULL) row.
--
-- THE FIX
-- -------
-- Create a UNIQUE index on the EXPRESSION
--     (COALESCE(tenant_id, ''), source_file, COALESCE(section, ''))
-- so the natural identity of a chunk is (tenant, file, section) with NULLs
-- folded to '' — making NULL-tenant (global) and NULL-section rows dedupe
-- deterministically. The ingest adapters target this exact expression in
-- their `ON CONFLICT` clause, so re-running the ingest overwrites in place.
--
-- Existing duplicates would block the unique-index build, so we FIRST delete
-- the older members of every duplicate group (keeping the newest by
-- `ingested_at`, tie-broken by `id`). On a fresh DB this DELETE is a no-op.
--
-- We also (re-)assert the cosine ANN indexes the retrieval path depends on
-- (KI-08): the live ANN query uses the cosine distance operator `<=>`, which
-- only uses an index built with `vector_cosine_ops`. The hnsw/ivfflat indexes
-- already ship in drizzle/0003 + drizzle/0012 with `vector_cosine_ops`; we
-- re-assert hnsw here `IF NOT EXISTS` so a DB that somehow missed 0012 is
-- self-healed and the operator/index pairing is guaranteed.
--
-- RLS: this migration does NOT add/alter any policy. The read/insert/update/
-- service-role policies + ENABLE/FORCE ROW LEVEL SECURITY were established in
-- 0310 and are re-asserted below for idempotent safety (FORCE applies RLS even
-- to the table owner). No policy is created or dropped here.
--
-- Idempotent: every object uses IF [NOT] EXISTS, the DELETE is naturally
-- re-runnable (no dup groups remain after the first run), and ENABLE/FORCE are
-- re-assertions. Migrations are immutable: this is a NEW forward file
-- (0310 is the prior tip; 0311 is the next free prefix).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'intelligence_corpus_chunks'
  ) THEN
    -- Keep RLS enabled + FORCEd (re-assertion; policies owned by 0310).
    EXECUTE 'ALTER TABLE intelligence_corpus_chunks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE intelligence_corpus_chunks FORCE  ROW LEVEL SECURITY';

    -- (1) DE-DUPLICATE existing rows on the new natural key so the UNIQUE
    --     index build cannot fail. Keep the NEWEST row per group; drop the
    --     rest. No-op on a fresh DB (every group has exactly one row).
    EXECUTE $dedup$
      DELETE FROM intelligence_corpus_chunks c
       USING (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(tenant_id, ''), source_file, COALESCE(section, '')
                  ORDER BY ingested_at DESC, id DESC
                ) AS rn
           FROM intelligence_corpus_chunks
       ) dup
       WHERE c.id = dup.id
         AND dup.rn > 1
    $dedup$;

    -- (2) The REAL upsert arbiter index. Expression-unique so NULL tenant_id
    --     (global corpus) and NULL section fold to '' and dedupe correctly.
    EXECUTE $uq$
      CREATE UNIQUE INDEX IF NOT EXISTS
        intelligence_corpus_chunks_tenant_source_section_uniq
        ON intelligence_corpus_chunks
        (COALESCE(tenant_id, ''), source_file, COALESCE(section, ''))
    $uq$;

    -- (3) Re-assert the cosine ANN index so the live `<=>` (cosine) query in
    --     chat-corpus-evidence.ts always lands on a matching operator class
    --     (KI-08). pgvector >= 0.5 ships `hnsw`; Supabase has it enabled.
    EXECUTE $hnsw$
      CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_embedding_hnsw
        ON intelligence_corpus_chunks
        USING hnsw (embedding vector_cosine_ops)
    $hnsw$;
  END IF;
END $$;

COMMIT;
