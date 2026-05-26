-- =============================================================================
-- 0092: Feedback Submissions + Complaints
-- =============================================================================
-- Closes Wave 18 gap: /api/v1/feedback + /api/v1/complaints shipped as
-- hardcoded fixture routers gated behind `liveDataRequired`. This migration
-- creates the persistence layer so both routers can serve real data.
--
-- Idempotent (IF NOT EXISTS) so repeated runs in dev / CI never fail.
-- =============================================================================

-- --- Feedback submissions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT,
  type              TEXT NOT NULL CHECK (type IN ('general','bug','feature','improvement')),
  subject           TEXT NOT NULL,
  message           TEXT NOT NULL,
  rating            INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  context           JSONB DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted','reviewing','resolved','closed')),
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_tenant_created
  ON feedback_submissions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status
  ON feedback_submissions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_type
  ON feedback_submissions (tenant_id, type, created_at DESC);

-- --- Complaints -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaint_records (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               TEXT,
  customer_id           TEXT,
  subject               TEXT NOT NULL,
  description           TEXT NOT NULL,
  category              TEXT CHECK (
                          category IS NULL OR
                          category IN ('maintenance','neighbor','payment','lease','other')
                        ),
  related_entity_type   TEXT,
  related_entity_id     TEXT,
  priority              TEXT NOT NULL DEFAULT 'medium'
                          CHECK (priority IN ('low','medium','high','urgent')),
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','in_progress','resolved','closed')),
  resolution            TEXT,
  resolution_notes      TEXT,
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaint_records_tenant_created
  ON complaint_records (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaint_records_status
  ON complaint_records (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaint_records_customer
  ON complaint_records (tenant_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_complaint_records_priority
  ON complaint_records (tenant_id, priority, status);
