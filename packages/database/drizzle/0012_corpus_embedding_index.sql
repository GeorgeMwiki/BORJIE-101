-- =============================================================================
-- Migration 0012 — HNSW index on intelligence_corpus_chunks.embedding
--
-- Promotes corpus search from sequential cosine scans to a sub-linear
-- HNSW ANN index. Issue #18.
--
-- The chat orchestrator's graceful-degradation path
-- (services/api-gateway/src/routes/mining/chat-corpus-evidence.ts) now
-- runs `ORDER BY embedding <-> $queryEmbedding LIMIT 5` against this
-- index when OPENAI_API_KEY is set (text-embedding-3-large truncated
-- to 1024-d to match the chunk column). When the API key is missing
-- the route falls back to ILIKE.
--
-- pgvector >= 0.5 ships the `hnsw` access method. Postgres on the
-- managed Supabase instance has it enabled.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_embedding_hnsw
  ON intelligence_corpus_chunks
  USING hnsw (embedding vector_cosine_ops);

COMMIT;
