-- ─────────────────────────────────────────────────────────────────────
-- Migration 0129 — Sovereign action ledger (hash-chained).
--
-- Append-only tamper-evident record of executed sovereign-tier actions
-- (tenant eviction proposed, owner payout executed, KRA MRI filed,
-- GePG control number revoked, ...). Each row's `this_hash` binds it
-- to the previous row in the same tenant's chain via:
--
--     this_hash = sha256(
--       prev_hash || tenant_id || action_type
--       || payload_hash || executed_at_iso
--     )
--
-- The first row per tenant has prev_hash = 64 zero hex digits
-- (GENESIS_HASH). Verification walks rows ordered by
-- (tenant_id, executed_at, id) and rejects on mismatch.
--
-- LITFIN parity: closes Gap C from .planning/parity-litfin/07-agency.md
-- (LITFIN's `sovereign_action_ledger` carries prev_hash/this_hash —
-- audit-ledger.ts:46-71,77-100,260-299. BORJIE's existing
-- kernel_action_audit captures every transition but is not chained.)
--
-- Idempotent: CREATE ... IF NOT EXISTS guards. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sovereign_action_ledger (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash    TEXT NOT NULL,
  proposer        TEXT NOT NULL,
  approvers       JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_at     TIMESTAMPTZ NOT NULL,
  prev_hash       TEXT NOT NULL,
  this_hash       TEXT NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-tenant chain traversal index: verification orders by
-- (tenant_id, executed_at, id) so the chain re-derives in insertion
-- order even when two actions share executed_at.
CREATE INDEX IF NOT EXISTS idx_sovereign_action_ledger_tenant_time
  ON sovereign_action_ledger (tenant_id, executed_at, id);

-- Per-tenant action-type filter for the operator-side dashboard
-- ("show me every owner-payout-executed in the last 30 days").
CREATE INDEX IF NOT EXISTS idx_sovereign_action_ledger_action_type
  ON sovereign_action_ledger (tenant_id, action_type);

-- this_hash lookup is rare but useful for "explain this audit row".
CREATE INDEX IF NOT EXISTS idx_sovereign_action_ledger_this_hash
  ON sovereign_action_ledger (this_hash);

COMMENT ON TABLE sovereign_action_ledger IS
  'Hash-chained audit ledger of EXECUTED sovereign-tier actions (the agency-side counterpart to kernel_action_audit, which captures every executor transition). Each row binds to its predecessor via this_hash = sha256(prev_hash || tenant_id || action_type || payload_hash || executed_at_iso). Append-only; tamper-evident.';
COMMENT ON COLUMN sovereign_action_ledger.prev_hash IS
  'Hash of the previous row in this tenant''s chain. The first row per tenant uses 64 zero hex digits (GENESIS_HASH).';
COMMENT ON COLUMN sovereign_action_ledger.this_hash IS
  'Computed on insert; immutable after. Re-deriving lets verifyLedgerChain detect any post-hoc edit.';
