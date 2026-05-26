-- =============================================================================
-- 0031: Feature flags + per-tenant overrides — Wave 9 enterprise polish
-- =============================================================================
-- Per-tenant gating for platform capabilities. Operators toggle features for
-- specific orgs without code deploys.
--
-- Shape:
--   feature_flags                    — platform-wide catalog (id PK,
--                                      flag_key UNIQUE, default_enabled)
--   tenant_feature_flag_overrides    — per-tenant override table (tenantId,
--                                      flagKey) with `enabled` bool.
--
-- Resolution order (service layer): tenant override → platform default.
-- Unknown flags return false.
--
-- Six seed rows are inserted here so operator-facing UIs can list defaults
-- immediately after migrating. All seeds default to TRUE; operators DISABLE
-- per-tenant as needed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  id              TEXT PRIMARY KEY,
  flag_key        TEXT NOT NULL UNIQUE,
  description     TEXT,
  default_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key
  ON feature_flags(flag_key);

CREATE TABLE IF NOT EXISTS tenant_feature_flag_overrides (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flag_key   TEXT NOT NULL REFERENCES feature_flags(flag_key) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_ff_tenant
  ON tenant_feature_flag_overrides(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ff_flag
  ON tenant_feature_flag_overrides(flag_key);

-- Seed platform defaults. Idempotent; re-running the migration is safe.
INSERT INTO feature_flags (id, flag_key, description, default_enabled)
VALUES
  ('ff_ai_negotiation',       'enable_ai_negotiation',
   'AI-guided lease/marketplace negotiation turn suggestions.', TRUE),
  ('ff_predictive_maint',     'enable_predictive_maintenance',
   'Predictive maintenance signals from IoT + history.', TRUE),
  ('ff_iot_ingest',           'enable_iot_ingest',
   'IoT observation ingestion + anomaly detection.', TRUE),
  ('ff_waitlist_outreach',    'enable_waitlist_outreach',
   'Automated waitlist vacancy outreach dispatch.', TRUE),
  ('ff_gdpr_delete',          'enable_gdpr_delete',
   'GDPR right-to-be-forgotten deletion requests.', TRUE),
  ('ff_letter_generation',    'enable_letter_generation',
   'AI-assisted formal letter generation.', TRUE)
ON CONFLICT (flag_key) DO NOTHING;
