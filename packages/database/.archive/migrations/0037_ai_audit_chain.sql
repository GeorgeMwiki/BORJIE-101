-- =============================================================================
-- 0037: AI audit hash chain — Wave-11 AI security hardening
-- =============================================================================
-- Tamper-evident audit log. Every AI turn writes one row. Each row carries the
-- SHA-256 hash of the previous row's hash + current payload, forming a chain.
-- A single tampered row breaks the chain on verify(). Append-only by design.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_audit_chain (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id     BIGINT NOT NULL,
  turn_id         TEXT NOT NULL,
  session_id      TEXT,
  action          TEXT NOT NULL,
  prev_hash       TEXT NOT NULL,
  this_hash       TEXT NOT NULL,
  payload_ref     TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_chain_tenant_seq
  ON ai_audit_chain(tenant_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_chain_turn
  ON ai_audit_chain(turn_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_chain_created
  ON ai_audit_chain(created_at DESC);

-- Sequence must be unique per tenant so chain verification is deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_audit_chain_tenant_seq
  ON ai_audit_chain(tenant_id, sequence_id);
