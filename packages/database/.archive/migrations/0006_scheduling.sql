-- BORJIE Scheduling Migration
-- Creates scheduled_events and availability tables

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE scheduled_event_type AS ENUM ('inspection', 'maintenance', 'viewing', 'meeting', 'reminder', 'other');
CREATE TYPE availability_recurrence AS ENUM ('daily', 'weekly', 'monthly', 'none');

-- ============================================================================
-- Scheduled Events Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Event info
  type scheduled_event_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,

  -- Timing
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT DEFAULT 'UTC',

  -- Related entity
  entity_type TEXT,
  entity_id TEXT,

  -- Location
  location TEXT,
  property_id TEXT REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),

  -- Assignment
  assigned_to TEXT REFERENCES users(id),
  assigned_vendor_id TEXT REFERENCES vendors(id),

  -- Notification
  reminder_minutes INTEGER,
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,

  -- Status
  status TEXT NOT NULL DEFAULT 'scheduled',

  -- Timestamps
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT
);

CREATE INDEX scheduled_events_tenant_idx ON scheduled_events(tenant_id);
CREATE INDEX scheduled_events_type_idx ON scheduled_events(type);
CREATE INDEX scheduled_events_start_at_idx ON scheduled_events(start_at);
CREATE INDEX scheduled_events_end_at_idx ON scheduled_events(end_at);
CREATE INDEX scheduled_events_entity_idx ON scheduled_events(entity_type, entity_id);
CREATE INDEX scheduled_events_assigned_idx ON scheduled_events(assigned_to);
CREATE INDEX scheduled_events_property_idx ON scheduled_events(property_id);
CREATE INDEX scheduled_events_date_range_idx ON scheduled_events(tenant_id, start_at, end_at);

CREATE TRIGGER scheduled_events_updated_at
  BEFORE UPDATE ON scheduled_events
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Availability Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Resource (user or vendor)
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,

  -- Time slot
  day_of_week INTEGER,
  start_time TIME,
  end_time TIME,
  start_date DATE,
  end_date DATE,

  -- Recurrence
  recurrence availability_recurrence NOT NULL DEFAULT 'none',

  -- Override (for one-off availability)
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,

  -- Status
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX availability_tenant_idx ON availability(tenant_id);
CREATE INDEX availability_resource_idx ON availability(resource_type, resource_id);
CREATE INDEX availability_day_idx ON availability(day_of_week);
CREATE INDEX availability_effective_idx ON availability(effective_from, effective_to);

CREATE TRIGGER availability_updated_at
  BEFORE UPDATE ON availability
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE scheduled_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduled_events_tenant_isolation ON scheduled_events
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY availability_tenant_isolation ON availability
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
