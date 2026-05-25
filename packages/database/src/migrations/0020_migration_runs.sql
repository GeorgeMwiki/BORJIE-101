-- Migration Runs: bulk onboarding lifecycle tracking
-- SCAFFOLDED 1 — supports the Migration Wizard commit path.

CREATE TYPE migration_run_status AS ENUM (
  'uploaded',
  'extracted',
  'diffed',
  'approved',
  'committing',
  'committed',
  'failed'
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by         TEXT NOT NULL,

  status             migration_run_status NOT NULL DEFAULT 'uploaded',

  upload_filename    TEXT,
  upload_mime_type   TEXT,
  upload_size_bytes  INTEGER,

  extraction_summary JSONB,
  diff_summary       JSONB,
  committed_summary  JSONB,
  bundle             JSONB,

  error_message      TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at        TIMESTAMPTZ,
  committed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS migration_runs_tenant_idx
  ON migration_runs(tenant_id);

CREATE INDEX IF NOT EXISTS migration_runs_status_idx
  ON migration_runs(status);

CREATE INDEX IF NOT EXISTS migration_runs_tenant_status_idx
  ON migration_runs(tenant_id, status);

CREATE INDEX IF NOT EXISTS migration_runs_created_at_idx
  ON migration_runs(created_at);
