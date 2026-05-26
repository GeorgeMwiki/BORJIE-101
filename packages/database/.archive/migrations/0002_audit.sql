-- BORJIE Audit Tables Migration
-- Creates audit_log table for comprehensive audit trail

-- ============================================================================
-- Audit Log Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Event info
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,

  -- Actor
  actor_id TEXT,
  actor_email TEXT,
  actor_name TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',

  -- Target
  target_type TEXT,
  target_id TEXT,

  -- Context
  ip_address TEXT,
  user_agent TEXT,
  session_id TEXT,

  -- Data
  previous_value JSONB,
  new_value JSONB,
  metadata JSONB DEFAULT '{}',

  -- Timestamp (immutable)
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for querying
CREATE INDEX audit_log_tenant_idx ON audit_log(tenant_id);
CREATE INDEX audit_log_event_type_idx ON audit_log(event_type);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_id);
CREATE INDEX audit_log_target_idx ON audit_log(target_type, target_id);
CREATE INDEX audit_log_occurred_at_idx ON audit_log(occurred_at);
CREATE INDEX audit_log_tenant_occurred_idx ON audit_log(tenant_id, occurred_at DESC);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_isolation ON audit_log
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
