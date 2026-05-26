-- BORJIE Compliance Migration
-- Creates compliance_items, compliance_cases, and compliance_notices tables

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE compliance_item_status AS ENUM ('pending', 'in_progress', 'completed', 'overdue', 'cancelled');
CREATE TYPE compliance_case_status AS ENUM ('open', 'in_review', 'resolved', 'closed');
CREATE TYPE compliance_notice_type AS ENUM ('violation', 'warning', 'inspection', 'renewal', 'other');

-- ============================================================================
-- Compliance Items Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  completed_date TIMESTAMPTZ,
  status compliance_item_status NOT NULL DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX compliance_items_tenant_idx ON compliance_items(tenant_id);
CREATE INDEX compliance_items_property_idx ON compliance_items(property_id);
CREATE INDEX compliance_items_unit_idx ON compliance_items(unit_id);
CREATE INDEX compliance_items_status_idx ON compliance_items(status);
CREATE INDEX compliance_items_due_date_idx ON compliance_items(due_date);

CREATE TRIGGER compliance_items_updated_at
  BEFORE UPDATE ON compliance_items
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Compliance Cases Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
  case_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status compliance_case_status NOT NULL DEFAULT 'open',
  severity INTEGER DEFAULT 0,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX compliance_cases_tenant_idx ON compliance_cases(tenant_id);
CREATE INDEX compliance_cases_property_idx ON compliance_cases(property_id);
CREATE INDEX compliance_cases_unit_idx ON compliance_cases(unit_id);
CREATE INDEX compliance_cases_status_idx ON compliance_cases(status);
CREATE INDEX compliance_cases_case_number_idx ON compliance_cases(case_number);

CREATE TRIGGER compliance_cases_updated_at
  BEFORE UPDATE ON compliance_cases
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Compliance Notices Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_notices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES compliance_cases(id) ON DELETE SET NULL,
  notice_type compliance_notice_type NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX compliance_notices_tenant_idx ON compliance_notices(tenant_id);
CREATE INDEX compliance_notices_property_idx ON compliance_notices(property_id);
CREATE INDEX compliance_notices_unit_idx ON compliance_notices(unit_id);
CREATE INDEX compliance_notices_case_idx ON compliance_notices(case_id);
CREATE INDEX compliance_notices_notice_type_idx ON compliance_notices(notice_type);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE compliance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY compliance_items_tenant_isolation ON compliance_items
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY compliance_cases_tenant_isolation ON compliance_cases
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY compliance_notices_tenant_isolation ON compliance_notices
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
