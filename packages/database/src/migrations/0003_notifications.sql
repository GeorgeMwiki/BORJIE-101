-- BORJIE Notifications Migration
-- Creates notifications and notification_templates tables

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE notification_channel AS ENUM ('email', 'sms', 'push', 'in_app', 'whatsapp');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'read');

-- ============================================================================
-- Notification Templates Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Template content
  channel notification_channel NOT NULL,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  variables JSONB DEFAULT '[]',

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX notification_templates_tenant_idx ON notification_templates(tenant_id);
CREATE UNIQUE INDEX notification_templates_code_tenant_idx ON notification_templates(tenant_id, code);
CREATE INDEX notification_templates_channel_idx ON notification_templates(channel);

CREATE TRIGGER notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Notifications Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Recipient (user or customer)
  recipient_type TEXT NOT NULL,
  recipient_id TEXT NOT NULL,

  -- Notification content
  type TEXT NOT NULL,
  channel notification_channel NOT NULL,
  subject TEXT,
  body TEXT,
  template_id TEXT REFERENCES notification_templates(id),

  -- Status
  status notification_status NOT NULL DEFAULT 'pending',

  -- Delivery
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  external_id TEXT,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_tenant_idx ON notifications(tenant_id);
CREATE INDEX notifications_recipient_idx ON notifications(recipient_type, recipient_id);
CREATE INDEX notifications_status_idx ON notifications(status);
CREATE INDEX notifications_channel_idx ON notifications(channel);
CREATE INDEX notifications_created_at_idx ON notifications(created_at);
CREATE INDEX notifications_recipient_unread_idx ON notifications(recipient_type, recipient_id) WHERE read_at IS NULL;

CREATE TRIGGER notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_templates_tenant_isolation ON notification_templates
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY notifications_tenant_isolation ON notifications
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
