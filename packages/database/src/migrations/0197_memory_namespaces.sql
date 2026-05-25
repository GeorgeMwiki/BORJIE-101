-- ─────────────────────────────────────────────────────────────────────
-- Migration 0197 — Memory namespaces (Piece D).
--
-- Concretised, rendered memory namespace keys. The persona's template
-- (e.g. 'tenant:{tenant_id}:persona:{persona_slug}:project:{project_id}')
-- is rendered into a concrete `namespace_key` and stored once per
-- (tenant, persona, project, module) combination. Memory ops then use
-- the FOREIGN KEY id, NOT the string template, so renames in the
-- template don't orphan data.
--
-- All tenant-scoped. RLS by current_setting('app.current_tenant_id').
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_namespaces (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id                  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  -- Nullable: customer personas usually omit project; MD-tier personas
  -- (T1/T2/T3) attach memory to a project.
  project_id                  TEXT,
  -- Nullable: module-scoped memory (e.g. maintenance, leasing) for a
  -- module-bound persona. Stored as text so we don't FK every module.
  module_id                   TEXT,
  -- The rendered namespace key, e.g.
  -- 'tenant:t_abc:persona:estate_officer:project:p_42'. Unique platform-
  -- wide because the tenant_id is already prefix in the key.
  namespace_key               TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace_key)
);

CREATE INDEX IF NOT EXISTS idx_memory_namespaces_tenant
  ON memory_namespaces (tenant_id);

CREATE INDEX IF NOT EXISTS idx_memory_namespaces_persona
  ON memory_namespaces (persona_id);

CREATE INDEX IF NOT EXISTS idx_memory_namespaces_project
  ON memory_namespaces (project_id) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_namespaces_tenant_persona_project
  ON memory_namespaces (tenant_id, persona_id, project_id);

COMMENT ON TABLE memory_namespaces IS
  'Piece D — concretised memory namespace keys per (tenant, persona, project, module). Stored once and referenced by id so template renames do not orphan data.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS memory_namespaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS memory_namespaces FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'memory_namespaces') THEN
    DROP POLICY IF EXISTS memory_namespaces_tenant_isolation ON memory_namespaces;
    CREATE POLICY memory_namespaces_tenant_isolation ON memory_namespaces
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS memory_namespaces_tenant_isolation_write ON memory_namespaces;
    CREATE POLICY memory_namespaces_tenant_isolation_write ON memory_namespaces
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
