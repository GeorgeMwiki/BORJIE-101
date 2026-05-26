-- =============================================================================
-- 0111: Audit Trail v2 — Wave 27 Agent C
-- =============================================================================
-- Cryptographically-verifiable audit trail spanning every AI action and every
-- human intervention/approval. Adds `audit_trail_entries` ALONGSIDE the
-- existing `audit_log` + `ai_audit_chain` tables (neither is removed; Wave 27
-- uses dual-write during the migration window so older consumers still see
-- their rows).
--
-- Design goals:
--   1. Per-tenant SHA-256 hash-chain (prev_hash → this_hash) — tampering with
--      any row breaks verification for that row + everything after it within
--      the same tenant.
--   2. Every row carries an HMAC-SHA256 signature so operators can prove the
--      row was minted by a node holding AUDIT_TRAIL_SIGNING_SECRET.
--   3. Evidence fields for AI rows — prompt hash, model version, token counts,
--      cost in micro-USD (integer, no float drift), and a free-form
--      `evidence_json` that carries source references.
--   4. `actor_kind` makes the human-vs-AI distinction first-class. The enum
--      covers the full spectrum the mandate called out: ai_autonomous,
--      human_approval, human_override, ai_proposal, ai_execution, plus
--      `system` for scheduler / cron jobs that are neither AI nor a user.
--   5. `action_category` supports the 11 named domains (finance, leasing,
--      maintenance, compliance, communications, marketing, HR, procurement,
--      insurance, legal, tenant_welfare). Strings not enums so future
--      categories don't require a migration.
--
-- Tenant isolation:
--   - `prev_hash` linkage is per tenant_id (unique sequence_id + tenant_id).
--   - RLS policy forces every SELECT/INSERT to obey app.current_tenant_id.
--
-- Append-only:
--   - Revoke UPDATE/DELETE from the runtime role in deployment, so only the
--     migration runner can mutate. The CHECK constraint on sequence_id also
--     protects against accidental negative values.
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_trail_entries (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Monotonic per-tenant sequence. Chain verification walks in this order.
  sequence_id         BIGINT NOT NULL CHECK (sequence_id >= 1),

  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who/what initiated the action. One of:
  --   ai_autonomous   — AI acted on its own authority (autonomy delegation)
  --   ai_proposal     — AI drafted a proposal awaiting human approval
  --   ai_execution    — AI executed after a human approval was recorded
  --   human_approval  — a human APPROVED something (approval transition)
  --   human_override  — a human overrode or cancelled an AI action
  --   human_action    — direct human action (no AI in the loop)
  --   system          — scheduler / cron / webhook (neither AI nor user)
  actor_kind          TEXT NOT NULL CHECK (actor_kind IN (
    'ai_autonomous',
    'ai_proposal',
    'ai_execution',
    'human_approval',
    'human_override',
    'human_action',
    'system'
  )),
  actor_id            TEXT,                       -- user_id, agent_id, or NULL for system
  actor_display       TEXT,                       -- denormalised display label (email, agent name)

  -- Action itself. `action_kind` is a stable verb-like identifier
  -- (e.g. `arrears.case_opened`, `renewal.approved`). `action_category`
  -- buckets it into one of the 11 domains for dashboards / filters.
  action_kind         TEXT NOT NULL,
  action_category     TEXT NOT NULL CHECK (action_category IN (
    'finance',
    'leasing',
    'maintenance',
    'compliance',
    'communications',
    'marketing',
    'hr',
    'procurement',
    'insurance',
    'legal',
    'tenant_welfare',
    'other'
  )),

  -- Subject the action happened TO. Resource URI follows a `bn://` scheme
  -- so downstream tooling can deep-link without guessing routes.
  subject_entity_type TEXT,                       -- e.g. `invoice`, `lease`, `case`
  subject_entity_id   TEXT,
  resource_uri        TEXT,                       -- e.g. `bn://invoices/inv_123`

  -- AI evidence — all nullable, populated when actor_kind starts with `ai_`.
  ai_model_version    TEXT,
  prompt_hash         TEXT,                       -- SHA-256 of canonical prompt
  prompt_tokens_in    INTEGER CHECK (prompt_tokens_in IS NULL OR prompt_tokens_in >= 0),
  prompt_tokens_out   INTEGER CHECK (prompt_tokens_out IS NULL OR prompt_tokens_out >= 0),
  cost_usd_micro      BIGINT CHECK (cost_usd_micro IS NULL OR cost_usd_micro >= 0),

  -- Evidence blob: sources consulted, tool calls, reasoning refs, etc.
  evidence_json       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- The decision/outcome. `decision` is one of `allow`, `deny`, `proposed`,
  -- `approved`, `rejected`, `executed`, `cancelled`, `noop`. Free-form so
  -- domains can extend, but typically stays inside these values.
  decision            TEXT NOT NULL DEFAULT 'executed',

  -- Hash-chain columns. prev_hash links to previous row for this tenant.
  -- this_hash = SHA-256 of (sequence_id || prev_hash || tenant_id ||
  -- occurred_at || actor_kind || action_kind || canonical(evidence_json)).
  prev_hash           TEXT NOT NULL,
  this_hash           TEXT NOT NULL,

  -- HMAC-SHA256 signature of this_hash using AUDIT_TRAIL_SIGNING_SECRET.
  -- Required in production (the app layer refuses to write without the env
  -- var set); left nullable here for test fixtures + local dev.
  signature           TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-tenant sequence uniqueness — the backbone of the hash chain.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_trail_tenant_seq
  ON audit_trail_entries (tenant_id, sequence_id);

-- Primary query shape: "most recent activity for tenant".
CREATE INDEX IF NOT EXISTS idx_audit_trail_tenant_occurred
  ON audit_trail_entries (tenant_id, occurred_at DESC);

-- Filter by actor_kind over a time range (drives the "AI-only" tab, etc.).
CREATE INDEX IF NOT EXISTS idx_audit_trail_tenant_actor_occurred
  ON audit_trail_entries (tenant_id, actor_kind, occurred_at DESC);

-- Filter by domain for the per-category dashboards.
CREATE INDEX IF NOT EXISTS idx_audit_trail_tenant_category_occurred
  ON audit_trail_entries (tenant_id, action_category, occurred_at DESC);

-- Lookup by subject entity for "show everything that touched this invoice".
CREATE INDEX IF NOT EXISTS idx_audit_trail_subject
  ON audit_trail_entries (tenant_id, subject_entity_type, subject_entity_id)
  WHERE subject_entity_id IS NOT NULL;

-- Chain verification walks by sequence_id — covered by uq index above but
-- an explicit BRIN index keeps sequential scans cheap on very large tables.
CREATE INDEX IF NOT EXISTS idx_audit_trail_seq_brin
  ON audit_trail_entries USING BRIN (tenant_id, sequence_id);

-- ---------------------------------------------------------------------------
-- Row-level security — identical pattern to `audit_log` and `ai_audit_chain`.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_trail_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_trail_tenant_isolation ON audit_trail_entries;
CREATE POLICY audit_trail_tenant_isolation ON audit_trail_entries
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

-- ---------------------------------------------------------------------------
-- Summary view — powers the /audit-trail/summary endpoint without scanning
-- the chain. Counts per (tenant, category, actor_kind, day).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW audit_trail_daily_summary AS
SELECT
  tenant_id,
  action_category,
  actor_kind,
  DATE_TRUNC('day', occurred_at) AS day,
  COUNT(*) AS entries,
  COALESCE(SUM(cost_usd_micro), 0) AS cost_usd_micro_total,
  COALESCE(SUM(prompt_tokens_in), 0) AS tokens_in_total,
  COALESCE(SUM(prompt_tokens_out), 0) AS tokens_out_total
FROM audit_trail_entries
GROUP BY tenant_id, action_category, actor_kind, DATE_TRUNC('day', occurred_at);

COMMENT ON TABLE audit_trail_entries IS
  'Wave 27 cryptographically-verifiable audit trail. Each row is chained to the previous row for the same tenant via prev_hash → this_hash (SHA-256) and signed via HMAC-SHA256. Tampering breaks chain verification.';

COMMENT ON COLUMN audit_trail_entries.prev_hash IS
  'SHA-256 of the previous row for this tenant_id. Genesis = constant GENESIS_PREV_HASH.';
COMMENT ON COLUMN audit_trail_entries.this_hash IS
  'SHA-256(sequence_id || prev_hash || tenant_id || occurred_at || actor_kind || action_kind || canonical(evidence_json) || decision).';
COMMENT ON COLUMN audit_trail_entries.signature IS
  'HMAC-SHA256(this_hash, AUDIT_TRAIL_SIGNING_SECRET). NULL only in dev/test.';
