-- ============================================================================
-- BORJIE — Inspection Extensions (NEW 19)
--
-- Additive columns on the existing `inspections` table plus a side-table
-- mirror (`inspection_extensions`) that serves environments where the ALTER
-- step is undesirable. Safe to run multiple times.
-- ============================================================================

-- Enum: inspection_kind ------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE inspection_kind AS ENUM (
    'move_in', 'move_out', 'routine', 'conditional_survey'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ALTER inspections ----------------------------------------------------------

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS kind                  inspection_kind,
  ADD COLUMN IF NOT EXISTS joint                 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS self_checkout_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tenant_signature_id   TEXT,
  ADD COLUMN IF NOT EXISTS landlord_signature_id TEXT;

CREATE INDEX IF NOT EXISTS inspections_kind_idx ON inspections(kind);

-- Side-table mirror ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspection_extensions (
  inspection_id          TEXT PRIMARY KEY REFERENCES inspections(id) ON DELETE CASCADE,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  kind                   inspection_kind,
  joint                  BOOLEAN NOT NULL DEFAULT FALSE,
  self_checkout_allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  tenant_signature_id    TEXT,
  landlord_signature_id  TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_extensions_tenant_idx ON inspection_extensions(tenant_id);
CREATE INDEX IF NOT EXISTS inspection_extensions_kind_idx   ON inspection_extensions(kind);

-- Row-level security (mirrors inspections) -----------------------------------

ALTER TABLE inspection_extensions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY inspection_extensions_tenant_isolation ON inspection_extensions
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
