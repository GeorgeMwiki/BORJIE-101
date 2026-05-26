-- =============================================================================
-- 0075: Marketing Leads — post-chat handoff profiles
-- =============================================================================
-- Captures structured summaries of prospect conversations with Mr. Mwikila
-- after they clear the engagement threshold (5+ meaningful turns OR explicit
-- "sign me up"). Lightweight: no full transcript, only the fields needed to
-- pre-fill signup. Unique index on session_id + hashed contact key makes the
-- insert idempotent so re-entering within 24h resumes the same profile.
--
-- tenant_id is NULL — these leads belong to BORJIE marketing, not a
-- tenant. Once converted, `converted_to_tenant_id` links the signed-up tenant.
-- =============================================================================

CREATE TABLE IF NOT EXISTS marketing_leads (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL,

  -- Structured handoff fields (pre-filled into signup form)
  role                      TEXT CHECK (role IN ('owner', 'tenant', 'manager', 'station_master', 'unknown')),
  portfolio_size            TEXT CHECK (portfolio_size IN ('micro', 'small', 'mid', 'large', 'unknown')),
  country                   TEXT CHECK (country IN ('KE', 'TZ', 'UG', 'other')),
  primary_pain              TEXT,
  summary                   TEXT NOT NULL,

  -- Engagement telemetry
  turn_count                INTEGER NOT NULL DEFAULT 0,
  explicit_signup_intent    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Optional contact (filled if the prospect shared it during chat)
  contact_name              TEXT,
  contact_method            TEXT CHECK (contact_method IN ('email', 'phone', 'whatsapp')),
  contact_value             TEXT,

  -- Conversion tracking
  converted_to_tenant_id    TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  converted_at              TIMESTAMPTZ,

  -- Idempotency key — hash(session_id) so re-entry within 24h resumes
  idempotency_key           TEXT NOT NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- One active lead per session_id; re-entering within 24h upserts the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_leads_session
  ON marketing_leads(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_leads_idempotency
  ON marketing_leads(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_country
  ON marketing_leads(country, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_role
  ON marketing_leads(role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_converted
  ON marketing_leads(converted_at DESC)
  WHERE converted_at IS NOT NULL;
