-- BORJIE Utilities Migration
-- Creates utility_accounts, utility_readings, and utility_bills tables

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE utility_type AS ENUM ('water', 'electricity', 'gas', 'internet', 'trash', 'other');
CREATE TYPE utility_bill_status AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

-- ============================================================================
-- Utility Accounts Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS utility_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  provider TEXT NOT NULL,
  utility_type utility_type NOT NULL,
  meter_number TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX utility_accounts_tenant_idx ON utility_accounts(tenant_id);
CREATE INDEX utility_accounts_property_idx ON utility_accounts(property_id);
CREATE INDEX utility_accounts_unit_idx ON utility_accounts(unit_id);
CREATE INDEX utility_accounts_account_number_idx ON utility_accounts(account_number);

CREATE TRIGGER utility_accounts_updated_at
  BEFORE UPDATE ON utility_accounts
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Utility Readings Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS utility_readings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES utility_accounts(id) ON DELETE CASCADE,
  reading_value DECIMAL(15, 4) NOT NULL,
  previous_reading DECIMAL(15, 4),
  unit TEXT NOT NULL DEFAULT 'kWh',
  reading_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX utility_readings_account_idx ON utility_readings(account_id);
CREATE INDEX utility_readings_reading_date_idx ON utility_readings(reading_date);

-- ============================================================================
-- Utility Bills Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS utility_bills (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES utility_accounts(id) ON DELETE CASCADE,
  reading_id TEXT REFERENCES utility_readings(id) ON DELETE SET NULL,
  bill_number TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  status utility_bill_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX utility_bills_account_idx ON utility_bills(account_id);
CREATE INDEX utility_bills_status_idx ON utility_bills(status);
CREATE INDEX utility_bills_period_idx ON utility_bills(period_start, period_end);

CREATE TRIGGER utility_bills_updated_at
  BEFORE UPDATE ON utility_bills
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE utility_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY utility_accounts_tenant_isolation ON utility_accounts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY utility_readings_tenant_isolation ON utility_readings
  FOR ALL USING (
    account_id IN (
      SELECT id FROM utility_accounts WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT
    )
  );

CREATE POLICY utility_bills_tenant_isolation ON utility_bills
  FOR ALL USING (
    account_id IN (
      SELECT id FROM utility_accounts WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT
    )
  );
