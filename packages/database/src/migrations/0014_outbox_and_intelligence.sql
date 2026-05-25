-- =============================================================================
-- 0014: Outbox + intelligence + identity + case-adjacent catchup
-- =============================================================================
-- Adds tables that existed in schema files but had no migration. Covers:
--   - event_outbox, event_dead_letter, event_subscriptions (outbox pattern)
--   - tenant_segments, customer_segment_memberships, tenant_preferences,
--     friction_fingerprints, next_best_actions, intervention_logs (intelligence)
--   - case_timelines, evidence_attachments, case_resolutions,
--     notice_service_receipts (legal/cases auxiliary)
--   - ocr_extractions, identity_profiles, verification_badges (documents)
--   - escalation_chains (communications)
--   - inspection_items, inspection_signatures (inspections)
--
-- Every table is tenant-isolated via tenant_id foreign key where applicable,
-- with cascade delete so tenant offboarding actually removes the data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Outbox pattern
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM (
    'pending', 'processing', 'published', 'failed', 'dead_letter'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_priority AS ENUM (
    'low', 'normal', 'high', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS event_outbox (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  aggregate_type   TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,
  payload          JSONB NOT NULL,
  metadata         JSONB DEFAULT '{}'::jsonb,
  sequence_number  INTEGER NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  status           outbox_status NOT NULL DEFAULT 'pending',
  priority         event_priority NOT NULL DEFAULT 'normal',
  retry_count      INTEGER NOT NULL DEFAULT 0,
  max_retries      INTEGER NOT NULL DEFAULT 5,
  last_error       TEXT,
  next_retry_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  trace_id         TEXT,
  span_id          TEXT,
  correlation_id   TEXT,
  causation_id     TEXT,
  locked_by        TEXT,
  locked_at        TIMESTAMPTZ,
  lock_expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS event_outbox_tenant_idx           ON event_outbox(tenant_id);
CREATE INDEX IF NOT EXISTS event_outbox_status_idx           ON event_outbox(status);
CREATE INDEX IF NOT EXISTS event_outbox_status_created_idx   ON event_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS event_outbox_aggregate_idx        ON event_outbox(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS event_outbox_event_type_idx       ON event_outbox(event_type);
CREATE INDEX IF NOT EXISTS event_outbox_next_retry_idx       ON event_outbox(next_retry_at);
CREATE INDEX IF NOT EXISTS event_outbox_priority_status_idx  ON event_outbox(priority, status);
CREATE INDEX IF NOT EXISTS event_outbox_correlation_idx      ON event_outbox(correlation_id);
CREATE INDEX IF NOT EXISTS event_outbox_lock_idx             ON event_outbox(locked_by, lock_expires_at);

CREATE TABLE IF NOT EXISTS event_dead_letter (
  id                  TEXT PRIMARY KEY,
  original_event_id   TEXT NOT NULL,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  aggregate_type      TEXT NOT NULL,
  aggregate_id        TEXT NOT NULL,
  payload             JSONB NOT NULL,
  metadata            JSONB DEFAULT '{}'::jsonb,
  failure_reason      TEXT NOT NULL,
  failure_details     JSONB,
  retry_history       JSONB DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  original_created_at TIMESTAMPTZ NOT NULL,
  resolved_at         TIMESTAMPTZ,
  resolved_by         TEXT,
  resolution_notes    TEXT
);

CREATE INDEX IF NOT EXISTS event_dead_letter_tenant_idx      ON event_dead_letter(tenant_id);
CREATE INDEX IF NOT EXISTS event_dead_letter_event_type_idx  ON event_dead_letter(event_type);
CREATE INDEX IF NOT EXISTS event_dead_letter_aggregate_idx   ON event_dead_letter(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS event_dead_letter_created_at_idx  ON event_dead_letter(created_at);
CREATE INDEX IF NOT EXISTS event_dead_letter_unresolved_idx  ON event_dead_letter(resolved_at);

CREATE TABLE IF NOT EXISTS event_subscriptions (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  subscriber_id           TEXT NOT NULL,
  subscriber_name         TEXT NOT NULL,
  event_pattern           TEXT NOT NULL,
  aggregate_pattern       TEXT,
  endpoint                TEXT NOT NULL,
  endpoint_type           TEXT NOT NULL DEFAULT 'http',
  headers                 JSONB DEFAULT '{}'::jsonb,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  max_events_per_second   INTEGER DEFAULT 100,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_subscriptions_tenant_idx     ON event_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS event_subscriptions_subscriber_idx ON event_subscriptions(subscriber_id);
CREATE INDEX IF NOT EXISTS event_subscriptions_pattern_idx    ON event_subscriptions(event_pattern);
CREATE INDEX IF NOT EXISTS event_subscriptions_active_idx     ON event_subscriptions(is_active);

-- Row-level security: outbox data is strictly tenant-scoped. Events from
-- one tenant must never leak via the drainer reading another tenant's rows.
ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_outbox_tenant_isolation ON event_outbox
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY event_dead_letter_tenant_isolation ON event_dead_letter
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY event_subscriptions_tenant_isolation ON event_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- -----------------------------------------------------------------------------
-- Intelligence
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_segments (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  segment_type  TEXT NOT NULL,
  criteria      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tenant_segments_tenant_idx ON tenant_segments(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_segments_type_idx   ON tenant_segments(segment_type);

CREATE TABLE IF NOT EXISTS customer_segment_memberships (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   TEXT NOT NULL,
  segment_id    TEXT NOT NULL REFERENCES tenant_segments(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at       TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS customer_segment_memberships_customer_idx ON customer_segment_memberships(customer_id);
CREATE INDEX IF NOT EXISTS customer_segment_memberships_segment_idx  ON customer_segment_memberships(segment_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_segment_unique ON customer_segment_memberships(customer_id, segment_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_preferences (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   TEXT NOT NULL,
  category      TEXT NOT NULL,
  preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_observed TIMESTAMPTZ,
  confidence    NUMERIC(4,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_preferences_customer_idx ON tenant_preferences(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_preferences_unique ON tenant_preferences(tenant_id, customer_id, category);

CREATE TABLE IF NOT EXISTS friction_fingerprints (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        TEXT NOT NULL,
  friction_type      TEXT NOT NULL,
  severity           TEXT NOT NULL,
  observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context            JSONB DEFAULT '{}'::jsonb,
  resolved_at        TIMESTAMPTZ,
  resolution_notes   TEXT,
  price_sensitivity  INTEGER CHECK (price_sensitivity BETWEEN 0 AND 100),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS friction_fingerprints_customer_idx ON friction_fingerprints(customer_id);
CREATE INDEX IF NOT EXISTS friction_fingerprints_type_idx     ON friction_fingerprints(friction_type);
CREATE INDEX IF NOT EXISTS friction_fingerprints_unresolved_idx ON friction_fingerprints(resolved_at);

-- NOTE: 0001b_add_missing_entities.sql already creates `next_best_actions`
-- with a different column shape (priority INTEGER, recommended_at, executed_at,
-- outcome, etc.). We keep the base CREATE TABLE as a no-op fallback and
-- additively ensure the columns this migration needs.
CREATE TABLE IF NOT EXISTS next_best_actions (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE next_best_actions
  ADD COLUMN IF NOT EXISTS action_type      TEXT,
  ADD COLUMN IF NOT EXISTS recommendation   TEXT,
  ADD COLUMN IF NOT EXISTS expected_outcome JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence       NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS generated_by     TEXT,
  ADD COLUMN IF NOT EXISTS valid_until      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acted_upon_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome_notes    TEXT;

CREATE INDEX IF NOT EXISTS next_best_actions_customer_idx ON next_best_actions(customer_id);
CREATE INDEX IF NOT EXISTS next_best_actions_priority_idx ON next_best_actions(priority);
CREATE INDEX IF NOT EXISTS next_best_actions_pending_idx  ON next_best_actions(acted_upon_at, dismissed_at);

CREATE TABLE IF NOT EXISTS intervention_logs (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id       TEXT NOT NULL,
  intervention_type TEXT NOT NULL,
  triggered_by      TEXT NOT NULL,
  trigger_context   JSONB DEFAULT '{}'::jsonb,
  outcome           TEXT,
  outcome_metadata  JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intervention_logs_customer_idx ON intervention_logs(customer_id);
CREATE INDEX IF NOT EXISTS intervention_logs_type_idx     ON intervention_logs(intervention_type);

-- Enable RLS on intelligence tables
ALTER TABLE tenant_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_segment_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE friction_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE next_best_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_segments_tenant_isolation ON tenant_segments
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY customer_segment_memberships_tenant_isolation ON customer_segment_memberships
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_preferences_tenant_isolation ON tenant_preferences
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY friction_fingerprints_tenant_isolation ON friction_fingerprints
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY next_best_actions_tenant_isolation ON next_best_actions
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY intervention_logs_tenant_isolation ON intervention_logs
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- -----------------------------------------------------------------------------
-- Legal / cases auxiliary
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_timelines (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT,
  summary       TEXT NOT NULL,
  details       JSONB DEFAULT '{}'::jsonb,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS case_timelines_case_idx    ON case_timelines(case_id);
CREATE INDEX IF NOT EXISTS case_timelines_occurred_idx ON case_timelines(occurred_at);

CREATE TABLE IF NOT EXISTS evidence_attachments (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id          TEXT NOT NULL,
  uploaded_by      TEXT NOT NULL,
  file_name        TEXT NOT NULL,
  file_url         TEXT NOT NULL,
  mime_type        TEXT,
  file_size_bytes  INTEGER CHECK (file_size_bytes >= 0),
  description      TEXT,
  exhibit_label    TEXT,
  sealed           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS evidence_attachments_case_idx ON evidence_attachments(case_id);

CREATE TABLE IF NOT EXISTS case_resolutions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id        TEXT NOT NULL UNIQUE,
  resolution_type TEXT NOT NULL,
  resolved_by    TEXT NOT NULL,
  resolved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_resolved INTEGER CHECK (amount_resolved IS NULL OR amount_resolved >= 0),
  amount_waived   INTEGER CHECK (amount_waived IS NULL OR amount_waived >= 0),
  currency       TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notice_service_receipts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notice_id     TEXT NOT NULL,
  served_method TEXT NOT NULL,
  served_to     TEXT NOT NULL,
  served_at     TIMESTAMPTZ NOT NULL,
  proof_url     TEXT,
  witness_name  TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notice_service_receipts_notice_idx ON notice_service_receipts(notice_id);

ALTER TABLE case_timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice_service_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_timelines_tenant_isolation ON case_timelines
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY evidence_attachments_tenant_isolation ON evidence_attachments
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY case_resolutions_tenant_isolation ON case_resolutions
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY notice_service_receipts_tenant_isolation ON notice_service_receipts
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- -----------------------------------------------------------------------------
-- Documents (OCR, identity, badges)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ocr_extractions (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_upload_id TEXT NOT NULL,
  provider          TEXT NOT NULL,
  raw_text          TEXT,
  structured_fields JSONB DEFAULT '{}'::jsonb,
  confidence_score  NUMERIC(4,3),
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_ms     INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ocr_extractions_document_idx ON ocr_extractions(document_upload_id);

CREATE TABLE IF NOT EXISTS identity_profiles (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL UNIQUE,
  verified_at         TIMESTAMPTZ,
  verified_by         TEXT,
  id_type             TEXT,
  id_number           TEXT,
  id_document_upload_id TEXT,
  full_name           TEXT,
  date_of_birth       DATE,
  country             TEXT,
  verification_score  NUMERIC(4,3),
  flags               JSONB DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_badges (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   TEXT NOT NULL,
  badge_type    TEXT NOT NULL,
  awarded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by    TEXT,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_badges_customer_idx ON verification_badges(customer_id);
CREATE INDEX IF NOT EXISTS verification_badges_active_idx   ON verification_badges(revoked_at);

ALTER TABLE ocr_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY ocr_extractions_tenant_isolation ON ocr_extractions
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY identity_profiles_tenant_isolation ON identity_profiles
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY verification_badges_tenant_isolation ON verification_badges
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- -----------------------------------------------------------------------------
-- Communications (escalation chains)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalation_chains (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  trigger_type   TEXT NOT NULL,
  steps          JSONB NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     TEXT,
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS escalation_chains_trigger_idx ON escalation_chains(trigger_type);

ALTER TABLE escalation_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY escalation_chains_tenant_isolation ON escalation_chains
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- -----------------------------------------------------------------------------
-- Inspection auxiliary
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspection_items (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id  TEXT NOT NULL,
  room           TEXT NOT NULL,
  item_name      TEXT NOT NULL,
  condition      TEXT NOT NULL,
  notes          TEXT,
  photo_urls     JSONB DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_items_inspection_idx ON inspection_items(inspection_id);

CREATE TABLE IF NOT EXISTS inspection_signatures (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id     TEXT NOT NULL,
  signer_role       TEXT NOT NULL,
  signer_user_id    TEXT,
  signer_full_name  TEXT NOT NULL,
  signature_url     TEXT,
  signed_at         TIMESTAMPTZ NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspection_signatures_inspection_idx ON inspection_signatures(inspection_id);

ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_items_tenant_isolation ON inspection_items
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY inspection_signatures_tenant_isolation ON inspection_signatures
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- End of 0014
