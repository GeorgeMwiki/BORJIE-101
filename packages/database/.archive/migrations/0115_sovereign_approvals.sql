-- ─────────────────────────────────────────────────────────────────────
-- Migration 0115 — Sovereign approvals (four-eye gate).
--
-- Persists four-eye approval records for sovereign-tier write actions
-- proposed by Nyumba Mind. Each action requires two distinct
-- approvers (proposer cannot self-approve) and expires after a TTL.
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE sovereign_approval_status AS ENUM (
    'pending', 'one-eye', 'approved', 'rejected', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sovereign_approval_stakes AS ENUM ('medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sovereign_approvals (
  action_id        TEXT PRIMARY KEY,
  tenant_id        TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  proposer_user_id TEXT NOT NULL,
  thought_id       TEXT NOT NULL,
  summary          TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  stakes           sovereign_approval_stakes NOT NULL,
  status           sovereign_approval_status NOT NULL,
  signatures       JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_at      TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sovereign_approvals_tenant_status
  ON sovereign_approvals (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_sovereign_approvals_proposer
  ON sovereign_approvals (proposer_user_id);

CREATE INDEX IF NOT EXISTS idx_sovereign_approvals_expires
  ON sovereign_approvals (expires_at);

COMMENT ON TABLE sovereign_approvals IS
  'Four-eye approval gate records for sovereign-tier write actions proposed by Nyumba Mind. Two distinct approvers required; proposer cannot self-approve; TTL-driven expiry.';
