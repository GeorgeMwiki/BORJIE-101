-- BORJIE Documents Migration
-- Creates documents and document_access tables

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE document_entity_type AS ENUM ('property', 'unit', 'lease', 'customer', 'invoice', 'work_order', 'other');

-- ============================================================================
-- Documents Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Entity reference
  entity_type document_entity_type NOT NULL,
  entity_id TEXT NOT NULL,

  -- File info
  name TEXT NOT NULL,
  original_name TEXT,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT,

  -- Metadata
  description TEXT,
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX documents_tenant_idx ON documents(tenant_id);
CREATE INDEX documents_entity_idx ON documents(entity_type, entity_id);
CREATE INDEX documents_created_at_idx ON documents(created_at);
CREATE INDEX documents_created_by_idx ON documents(created_by);

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Document Access Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_access (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Grantee (user or customer)
  grantee_type TEXT NOT NULL,
  grantee_id TEXT NOT NULL,

  -- Access level
  access_level TEXT NOT NULL DEFAULT 'read',

  -- Validity
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT,
  expires_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX document_access_document_idx ON document_access(document_id);
CREATE INDEX document_access_grantee_idx ON document_access(grantee_type, grantee_id);
CREATE INDEX document_access_expires_idx ON document_access(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY documents_tenant_isolation ON documents
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY document_access_tenant_isolation ON document_access
  FOR ALL USING (
    document_id IN (
      SELECT id FROM documents WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT
    )
  );
