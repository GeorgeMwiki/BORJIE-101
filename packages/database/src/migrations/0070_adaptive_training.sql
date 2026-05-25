-- =============================================================================
-- 0070: Adaptive Training — admin-driven, Mr. Mwikila-generated training paths
-- =============================================================================
-- Replaces the classroom/course mental model. Admins describe in natural
-- language what needs to be taught; Mr. Mwikila (Professor sub-persona)
-- generates a TrainingPath on demand, assigns it to named employees, and the
-- existing Wave-11 BKT (`bkt_mastery`) tracks concept mastery.
--
-- Tables:
--   training_paths             — generated, editable, versioned per tenant
--   training_path_steps        — ordered steps, each pinned to a concept
--   training_assignments       — a path assigned to one employee, with status
--   training_delivery_events   — append-only event stream of deliveries
-- =============================================================================

CREATE TABLE IF NOT EXISTS training_paths (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  topic             TEXT NOT NULL,
  audience          TEXT NOT NULL CHECK (audience IN (
                      'station-masters','estate-officers','caretakers',
                      'accountants','owners','tenants','custom')),
  language          TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','sw','both')),
  duration_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  concept_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary           TEXT,
  generated_by      TEXT NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_paths_topic_audience
  ON training_paths(tenant_id, topic, audience)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_training_paths_tenant
  ON training_paths(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS training_path_steps (
  id                 TEXT PRIMARY KEY,
  path_id            TEXT NOT NULL REFERENCES training_paths(id) ON DELETE CASCADE,
  order_index        INTEGER NOT NULL CHECK (order_index >= 0),
  concept_id         TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN (
                       'lesson','scenario','quiz','handout','roleplay','reflection')),
  title              TEXT NOT NULL,
  content            JSONB NOT NULL DEFAULT '{}'::jsonb,
  mastery_threshold  DOUBLE PRECISION NOT NULL DEFAULT 0.8
                       CHECK (mastery_threshold > 0 AND mastery_threshold <= 1),
  estimated_minutes  INTEGER NOT NULL DEFAULT 5 CHECK (estimated_minutes > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_path_steps_path_order
  ON training_path_steps(path_id, order_index);

CREATE TABLE IF NOT EXISTS training_assignments (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  path_id              TEXT NOT NULL REFERENCES training_paths(id) ON DELETE CASCADE,
  assignee_user_id     TEXT NOT NULL,
  assigned_by          TEXT NOT NULL,
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at               TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                         'pending','in_progress','completed','abandoned','reassigned')),
  completed_at         TIMESTAMPTZ,
  progress_pct         DOUBLE PRECISION NOT NULL DEFAULT 0
                         CHECK (progress_pct >= 0 AND progress_pct <= 1),
  last_delivered_step  TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_assignments_path_assignee
  ON training_assignments(tenant_id, path_id, assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_training_assignments_assignee
  ON training_assignments(tenant_id, assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_training_assignments_status
  ON training_assignments(tenant_id, status, assigned_at DESC);

CREATE TABLE IF NOT EXISTS training_delivery_events (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id   TEXT NOT NULL REFERENCES training_assignments(id) ON DELETE CASCADE,
  step_id         TEXT,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'step_started','answer_submitted','concept_mastered',
                    'stuck','continued','path_completed')),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_delivery_events_assignment
  ON training_delivery_events(assignment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_delivery_events_type
  ON training_delivery_events(tenant_id, event_type, occurred_at DESC);
