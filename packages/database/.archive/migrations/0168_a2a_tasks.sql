-- ============================================================================
-- Migration 0168 — A2A v1.0 task state store.
--
-- Persistent backing for the `TaskStore` port declared in
-- `packages/agent-platform/src/a2a/task-lifecycle.ts`. One row per A2A
-- task; status transitions submitted -> working -> { completed | failed
-- | canceled } owned by the lifecycle module.
--
-- Multi-tenant isolation: tenant_id is mandatory at the adapter layer
-- (the in-memory port is single-tenant by design; the persistent
-- adapter adds tenant scope so RLS migration 0155 covers it).
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS.
-- Backwards-compatible: no destructive ALTERs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  status          TEXT NOT NULL,
  message         JSONB NOT NULL,
  artifacts       JSONB NOT NULL DEFAULT '[]'::jsonb,
  error           TEXT,
  created_at_iso  TEXT NOT NULL,
  updated_at_iso  TEXT NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_tenant_session
  ON a2a_tasks (tenant_id, session_id);

CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status
  ON a2a_tasks (status);

COMMENT ON TABLE a2a_tasks IS
  'A2A v1.0 task store. Status transitions: submitted -> working -> { completed | failed | canceled }.';
COMMENT ON COLUMN a2a_tasks.tenant_id IS
  'Mandatory multi-tenant scope added by the persistent adapter (in-memory port is single-tenant).';
