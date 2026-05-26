-- ─────────────────────────────────────────────────────────────────────
-- Migration 0198 — Cross-persona escalation tickets (Piece D).
--
-- When a persona cannot resolve a request within its scope or below its
-- max_action_tier, it OPENS a ticket targeted at another persona or
-- user. The autonomy-gate four-eye flow consumes `required_approval_
-- policy_id` (FK soft — references approval_policies if/when its schema
-- exists in this build).
--
-- Status machine:
--   open → in_progress → approved | rejected → closed
--   open → closed                                 (cancellation)
--
-- Tenant-scoped, RLS-protected. Append-only is enforced at the
-- application layer (status transitions go through a service); the
-- table is mutable so the resolution timestamp can be set.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_persona_id           TEXT NOT NULL REFERENCES personas(id),
  -- One OR the other (or both) of these must be set in application
  -- code; the constraint is intentionally loose so the table accepts
  -- "any persona of this kind picks it up" routing.
  target_persona_id           TEXT REFERENCES personas(id),
  target_user_id              TEXT REFERENCES users(id),
  title                       TEXT NOT NULL,
  body_jsonb                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Soft reference — the approval-policies table id when this ticket
  -- requires four-eye / executive approval.
  required_approval_policy_id TEXT,
  status                      TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'approved', 'rejected', 'closed')),
  created_by_user_id          TEXT NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant
  ON tickets (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status
  ON tickets (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_tickets_target_persona
  ON tickets (target_persona_id) WHERE target_persona_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_target_user
  ON tickets (target_user_id) WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_created_at
  ON tickets (created_at DESC);

COMMENT ON TABLE tickets IS
  'Piece D — cross-persona escalation tickets. A persona opens a ticket when its scope or max_action_tier blocks a needed action; another persona/user resolves.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tickets FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'tickets') THEN
    DROP POLICY IF EXISTS tickets_tenant_isolation ON tickets;
    CREATE POLICY tickets_tenant_isolation ON tickets
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS tickets_tenant_isolation_write ON tickets;
    CREATE POLICY tickets_tenant_isolation_write ON tickets
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
