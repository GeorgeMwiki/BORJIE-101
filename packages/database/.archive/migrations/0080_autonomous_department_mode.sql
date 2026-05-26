-- =============================================================================
-- 0080: Autonomous Department Mode
-- =============================================================================
-- Wave-13 deliverable: the head of estates sets delegation policy once and
-- Mr. Mwikila runs the department autonomously inside those rails. Every
-- autonomous decision is audited; only exceptions surface to the head.
--
-- Tables
--   autonomy_policies           — per-tenant autonomy configuration (master
--                                 switch + per-domain rule blocks)
--   exception_inbox             — items needing a human decision (P1/P2/P3)
--   executive_briefings         — weekly/monthly briefings for the head
--   autonomous_action_audit     — every autonomous action with reasoning
-- =============================================================================

CREATE TABLE IF NOT EXISTS autonomy_policies (
  tenant_id                    TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  autonomous_mode_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  policy_json                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  escalation_primary_user_id   TEXT,
  escalation_secondary_user_id TEXT,
  version                      INTEGER NOT NULL DEFAULT 1,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_autonomy_policies_enabled
  ON autonomy_policies(tenant_id, autonomous_mode_enabled);

CREATE TABLE IF NOT EXISTS exception_inbox (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain                TEXT NOT NULL CHECK (domain IN (
                          'finance','leasing','maintenance','compliance',
                          'communications','strategic','anomaly')),
  kind                  TEXT NOT NULL,
  priority              TEXT NOT NULL DEFAULT 'P2'
                          CHECK (priority IN ('P1','P2','P3')),
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  amount_minor_units    BIGINT,
  due_at                TIMESTAMPTZ,
  strategic_weight      INTEGER NOT NULL DEFAULT 0 CHECK (strategic_weight >= 0),
  recommended_action    TEXT,
  evidence_refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','resolved','dismissed')),
  resolution_decision   TEXT,
  resolution_note       TEXT,
  resolved_by_user_id   TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exception_inbox_tenant_status
  ON exception_inbox(tenant_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_exception_inbox_domain
  ON exception_inbox(tenant_id, domain, created_at DESC);

CREATE TABLE IF NOT EXISTS executive_briefings (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cadence               TEXT NOT NULL CHECK (cadence IN ('weekly','monthly','adhoc')),
  period_start          TIMESTAMPTZ NOT NULL,
  period_end            TIMESTAMPTZ NOT NULL,
  headline              TEXT NOT NULL,
  portfolio_health      JSONB NOT NULL DEFAULT '{}'::jsonb,
  wins                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  exceptions            JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  focus_next_period     JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_markdown         TEXT NOT NULL,
  voice_audio_url       TEXT,
  generated_by          TEXT NOT NULL,
  delivered_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executive_briefings_tenant
  ON executive_briefings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executive_briefings_cadence
  ON executive_briefings(tenant_id, cadence, period_end DESC);

CREATE TABLE IF NOT EXISTS autonomous_action_audit (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_persona         TEXT NOT NULL,
  action                TEXT NOT NULL,
  domain                TEXT NOT NULL,
  target_entity_kind    TEXT,
  target_entity_id      TEXT,
  reasoning             TEXT NOT NULL,
  evidence_refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence            DOUBLE PRECISION NOT NULL DEFAULT 0
                          CHECK (confidence >= 0 AND confidence <= 1),
  policy_rule_matched   TEXT,
  chain_id              TEXT,
  reviewed_by_user_id   TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auton_audit_tenant_created
  ON autonomous_action_audit(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auton_audit_domain
  ON autonomous_action_audit(tenant_id, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auton_audit_chain
  ON autonomous_action_audit(chain_id);
