-- ============================================================================
-- BORJIE Brain — Conversation Schema (threads, thread_events, handoff_packets)
--
-- Append-only event log backing the Brain's Thread Store. Every event carries
-- a visibility label and is tenant-scoped via RLS.
-- ============================================================================

-- Enums --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE thread_status AS ENUM ('open', 'resolved', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE thread_event_kind AS ENUM (
    'user_message',
    'persona_message',
    'tool_call',
    'tool_result',
    'handoff_out',
    'handoff_in',
    'review_requested',
    'review_decision',
    'system_note'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE visibility_scope AS ENUM (
    'private', 'team', 'management', 'public'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Threads ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS threads (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  initiating_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  primary_persona_id  TEXT NOT NULL,
  team_id             TEXT,
  employee_id         TEXT,
  title               TEXT NOT NULL,
  status              thread_status NOT NULL DEFAULT 'open',
  event_count         INTEGER NOT NULL DEFAULT 0,
  last_event_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS threads_tenant_idx ON threads(tenant_id);
CREATE INDEX IF NOT EXISTS threads_user_idx ON threads(initiating_user_id);
CREATE INDEX IF NOT EXISTS threads_persona_idx ON threads(tenant_id, primary_persona_id);
CREATE INDEX IF NOT EXISTS threads_team_idx ON threads(team_id);
CREATE INDEX IF NOT EXISTS threads_employee_idx ON threads(employee_id);
CREATE INDEX IF NOT EXISTS threads_status_idx ON threads(tenant_id, status);

-- Thread events ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS thread_events (
  id                              TEXT PRIMARY KEY,
  tenant_id                       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id                       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  kind                            thread_event_kind NOT NULL,
  actor_id                        TEXT NOT NULL,
  visibility_scope                visibility_scope NOT NULL,
  visibility_author_actor_id      TEXT NOT NULL,
  visibility_initiating_user_id   TEXT,
  visibility_team_id              TEXT,
  visibility_rationale            TEXT,
  parent_event_id                 TEXT,
  payload                         JSONB NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thread_events_tenant_idx ON thread_events(tenant_id);
CREATE INDEX IF NOT EXISTS thread_events_thread_idx ON thread_events(thread_id);
CREATE INDEX IF NOT EXISTS thread_events_kind_idx ON thread_events(tenant_id, kind);
CREATE INDEX IF NOT EXISTS thread_events_actor_idx ON thread_events(actor_id);
CREATE INDEX IF NOT EXISTS thread_events_created_idx ON thread_events(created_at);
CREATE INDEX IF NOT EXISTS thread_events_parent_idx ON thread_events(parent_event_id);

-- Handoff packets ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS handoff_packets (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id             TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  event_id              TEXT NOT NULL REFERENCES thread_events(id) ON DELETE CASCADE,
  source_persona_id     TEXT NOT NULL,
  target_persona_id     TEXT NOT NULL,
  objective             TEXT NOT NULL,
  output_format         TEXT NOT NULL,
  context_summary       TEXT NOT NULL,
  latest_user_message   TEXT,
  relevant_entities     JSONB NOT NULL DEFAULT '[]'::jsonb,
  prior_decisions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  constraints           JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_tools         TEXT[] DEFAULT ARRAY[]::TEXT[],
  visibility_scope      visibility_scope NOT NULL,
  tokens_so_far         INTEGER NOT NULL DEFAULT 0,
  token_budget          INTEGER NOT NULL,
  accepted              BOOLEAN NOT NULL DEFAULT false,
  accepted_at           TIMESTAMPTZ,
  accepted_by           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS handoff_packets_tenant_idx ON handoff_packets(tenant_id);
CREATE INDEX IF NOT EXISTS handoff_packets_thread_idx ON handoff_packets(thread_id);
CREATE INDEX IF NOT EXISTS handoff_packets_source_idx ON handoff_packets(source_persona_id);
CREATE INDEX IF NOT EXISTS handoff_packets_target_idx ON handoff_packets(target_persona_id);

-- Row Level Security -------------------------------------------------------

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_packets ENABLE ROW LEVEL SECURITY;

CREATE POLICY threads_tenant_isolation ON threads
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY thread_events_tenant_isolation ON thread_events
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
CREATE POLICY handoff_packets_tenant_isolation ON handoff_packets
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
