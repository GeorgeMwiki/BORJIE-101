-- =============================================================================
-- 0042: AI progressive context — append-only accumulator snapshots
-- =============================================================================
-- Every accumulator update writes a new row. Operators can rewind to any
-- version. Tenant-scoped. jsonb holds the full AccumulatedEstateContext.
-- =============================================================================

CREATE TABLE IF NOT EXISTS progressive_context_snapshots (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id         TEXT NOT NULL,
  version            INTEGER NOT NULL CHECK (version > 0),
  context            JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_context_version UNIQUE (tenant_id, session_id, version)
);

CREATE INDEX IF NOT EXISTS idx_context_snap_tenant_session
  ON progressive_context_snapshots(tenant_id, session_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_context_snap_created
  ON progressive_context_snapshots(tenant_id, created_at DESC);
