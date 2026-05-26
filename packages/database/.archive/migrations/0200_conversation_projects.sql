-- ─────────────────────────────────────────────────────────────────────
-- Migration 0200 — Conversation projects (Piece F).
--
-- MD-tier "folders" that group related threads. Only personas with
-- power_tier ≤ 3 (OWNER/ADMIN/MANAGER) can own projects — customers
-- and field staff get a single thread per channel, no project layer.
-- The runtime enforces the tier check (see persona-runtime's project
-- guard). The schema permits any persona owner so the constraint can
-- evolve without a migration.
--
-- Projects carry:
--   - module_scope        — which modules the project sees (drives the
--                           cross-thread retrieval filter)
--   - custom_instructions — appended to the persona's system prompt
--                           inside this project's threads
--   - memory_scope_id     — joined namespace key for cross-thread recall
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_projects (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id               TEXT NOT NULL REFERENCES users(id),
  owner_persona_id            TEXT NOT NULL REFERENCES personas(id),
  name                        TEXT NOT NULL,
  description                 TEXT,
  module_scope                TEXT[] NOT NULL DEFAULT '{}',
  custom_instructions         TEXT,
  memory_scope_id             TEXT REFERENCES memory_namespaces(id),
  pinned                      BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_projects_tenant
  ON conversation_projects (tenant_id);

CREATE INDEX IF NOT EXISTS idx_conversation_projects_owner
  ON conversation_projects (owner_user_id, owner_persona_id);

CREATE INDEX IF NOT EXISTS idx_conversation_projects_archived
  ON conversation_projects (archived_at) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_projects_pinned
  ON conversation_projects (tenant_id, pinned) WHERE pinned = TRUE;

COMMENT ON TABLE conversation_projects IS
  'Piece F — MD-tier project folders grouping threads. Persona tier ≤ 3 is enforced at runtime by persona-runtime.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS conversation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversation_projects FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'conversation_projects') THEN
    DROP POLICY IF EXISTS conversation_projects_tenant_isolation ON conversation_projects;
    CREATE POLICY conversation_projects_tenant_isolation ON conversation_projects
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS conversation_projects_tenant_isolation_write ON conversation_projects;
    CREATE POLICY conversation_projects_tenant_isolation_write ON conversation_projects
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
