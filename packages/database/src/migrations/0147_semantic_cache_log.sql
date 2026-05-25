-- ─────────────────────────────────────────────────────────────────────
-- Migration 0147 — Semantic cache hit/miss telemetry log.
--
-- Phase D D4 — LLM cost reduction via semantic caching + Anthropic
-- prompt prefix caching. This table is the append-only telemetry
-- surface for the semantic-cache layer (see
-- `packages/central-intelligence/src/kernel/semantic-cache/`).
--
-- Every cache lookup writes one row:
--   - 'hit'   → the value was served from cache; `cost_usd_micros`
--               is what we SAVED (the LLM call that did NOT happen).
--   - 'miss'  → no entry matched; `cost_usd_micros` is what we are
--               ABOUT to spend on the model call now triggered.
--   - 'skip'  → the cache deliberately stayed out of the way (e.g.
--               command-intent, embedder-unconfigured); cost is 0.
--
-- Cost is stored as BIGINT micro-dollars (1e-6 USD) so we never
-- touch floats. Aggregations (sum per tenant per day) divide by
-- 1_000_000 only at display time.
--
-- Hard guardrails:
--   - tenant_id NULLABLE only for platform-tier turns (HQ scope).
--     Tenant cascade ensures GDPR purges sweep this log too.
--   - Append-only by convention; no UPDATE / DELETE path in the
--     service. Retention is operator-driven (vacuum cron lands in a
--     follow-up — at one row per turn we expect ~100M rows/year at
--     full scale, which is fine for Postgres).
--   - Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
--     EXISTS so re-running the migration is safe.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS semantic_cache_log (
  id                  TEXT PRIMARY KEY,
  /** NULL for platform-tier (sovereign) turns; otherwise the tenant
      whose semantic-cache bucket was consulted. */
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  /** e.g. 'tenant-portal', 'manager-portal', 'sovereign-cockpit'. */
  surface             TEXT NOT NULL,
  /** Persona id at the moment of the lookup (e.g. 'tenant-resident'). */
  persona_id          TEXT NOT NULL,
  /** 'hit' | 'miss' | 'skip' — keep as TEXT for forward compat. */
  outcome             TEXT NOT NULL,
  /** Inferred intent that drove the TTL policy:
      'greeting' | 'acknowledgment' | 'farewell' | 'platform_intro' |
      'question' | 'command'. */
  intent              TEXT NOT NULL,
  /** Cosine similarity on hit; NULL on miss/skip. */
  similarity          DOUBLE PRECISION,
  /** Threshold applied at the moment of the lookup. */
  threshold           DOUBLE PRECISION NOT NULL,
  /** Model the cost is computed against (hit → saved, miss → spent). */
  model_id            TEXT NOT NULL,
  /** Cost saved (hit) or that WOULD have been spent (miss). Stored
      as BIGINT micro-dollars. */
  cost_usd_micros     BIGINT NOT NULL DEFAULT 0,
  /** Estimated prompt / completion tokens of the call avoided
      (hit) or about to happen (miss). */
  prompt_tokens       INTEGER NOT NULL DEFAULT 0,
  completion_tokens   INTEGER NOT NULL DEFAULT 0,
  /** Reason for a 'skip' outcome (e.g. 'intent=command',
      'embedder-failed'); NULL for hit/miss. */
  skip_reason         TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_log_tenant_time
  ON semantic_cache_log (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_log_outcome_time
  ON semantic_cache_log (outcome, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_log_tenant_outcome
  ON semantic_cache_log (tenant_id, outcome, occurred_at DESC);

COMMENT ON TABLE semantic_cache_log IS
  'Append-only telemetry for the semantic-cache layer (Phase D D4). One row per kernel lookup; cost in micro-dollars.';

COMMENT ON COLUMN semantic_cache_log.cost_usd_micros IS
  'Micro-dollars (1e-6 USD). hit ⇒ cost SAVED. miss ⇒ cost ABOUT to be spent. skip ⇒ 0.';

COMMENT ON COLUMN semantic_cache_log.similarity IS
  'Cosine similarity of the lookup vector vs. matched entry. NULL on miss/skip.';

COMMENT ON COLUMN semantic_cache_log.threshold IS
  'Similarity threshold applied at lookup time. Default 0.95 — tunable per tenant.';
