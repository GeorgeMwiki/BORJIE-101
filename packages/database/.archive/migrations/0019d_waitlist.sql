-- ============================================================================
-- BORJIE — Waitlist (Auto-Outreach on Vacancy)
--
-- Tracks prospects interested in a unit and the audit trail of outreach
-- messages when the unit becomes vacant.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE waitlist_status AS ENUM (
    'active', 'converted', 'expired', 'opted_out'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE waitlist_source AS ENUM (
    'enquiry',
    'failed_application',
    'manual_add',
    'marketplace_save',
    'ai_recommended'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE waitlist_channel AS ENUM (
    'sms', 'whatsapp', 'email', 'push', 'in_app'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE waitlist_outreach_event_type AS ENUM (
    'vacancy_notified',
    'viewed',
    'applied',
    'declined',
    'opted_out',
    'delivery_failed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Waitlists ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS unit_waitlists (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                     TEXT REFERENCES units(id),
  listing_id                  TEXT,
  customer_id                 TEXT NOT NULL REFERENCES customers(id),
  priority                    INTEGER NOT NULL DEFAULT 100,
  source                      waitlist_source NOT NULL DEFAULT 'enquiry',
  status                      waitlist_status NOT NULL DEFAULT 'active',
  notification_preference_id  TEXT,
  preferred_channels          JSONB DEFAULT '[]'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                  TIMESTAMPTZ,
  converted_at                TIMESTAMPTZ,
  opted_out_at                TIMESTAMPTZ,
  opt_out_reason              TEXT,
  last_notified_at            TIMESTAMPTZ,
  notification_count          INTEGER NOT NULL DEFAULT 0,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unit_waitlists_tenant_idx ON unit_waitlists(tenant_id);
CREATE INDEX IF NOT EXISTS unit_waitlists_unit_idx ON unit_waitlists(unit_id);
CREATE INDEX IF NOT EXISTS unit_waitlists_customer_idx ON unit_waitlists(customer_id);
CREATE INDEX IF NOT EXISTS unit_waitlists_status_idx ON unit_waitlists(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS unit_waitlists_unique_active_idx
  ON unit_waitlists(tenant_id, unit_id, customer_id);

-- Outreach Events (APPEND-ONLY) -------------------------------------------

CREATE TABLE IF NOT EXISTS waitlist_outreach_events (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waitlist_id           TEXT NOT NULL REFERENCES unit_waitlists(id) ON DELETE CASCADE,
  event_type            waitlist_outreach_event_type NOT NULL,
  channel               waitlist_channel NOT NULL,
  message_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id        TEXT,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_message_id   TEXT,
  error_code            TEXT,
  error_message         TEXT
);
CREATE INDEX IF NOT EXISTS waitlist_outreach_events_tenant_idx ON waitlist_outreach_events(tenant_id);
CREATE INDEX IF NOT EXISTS waitlist_outreach_events_waitlist_idx ON waitlist_outreach_events(waitlist_id);
CREATE INDEX IF NOT EXISTS waitlist_outreach_events_occurred_at_idx ON waitlist_outreach_events(occurred_at);
CREATE INDEX IF NOT EXISTS waitlist_outreach_events_type_idx ON waitlist_outreach_events(waitlist_id, event_type);

-- Append-only guard
CREATE OR REPLACE FUNCTION waitlist_outreach_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'waitlist_outreach_events is append-only; % blocked', TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER waitlist_outreach_events_no_update
    BEFORE UPDATE ON waitlist_outreach_events
    FOR EACH ROW EXECUTE FUNCTION waitlist_outreach_events_immutable();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TRIGGER waitlist_outreach_events_no_delete
    BEFORE DELETE ON waitlist_outreach_events
    FOR EACH ROW EXECUTE FUNCTION waitlist_outreach_events_immutable();
EXCEPTION WHEN duplicate_object THEN null; END $$;
