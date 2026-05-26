-- =============================================================================
-- 0041: AI intelligence feedback — decision feedback + proactive alerts
-- =============================================================================
-- Persists operator approvals/rejections on Brain-emitted PROPOSED_ACTION
-- and proactive alerts surfaced by the Intelligence Orchestrator.
-- Additive; no changes to existing tables. All rows tenant-scoped.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_decision_feedback (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  turn_id            TEXT NOT NULL,
  persona_id         TEXT NOT NULL,
  proposed_verb      TEXT NOT NULL,
  proposed_object    TEXT NOT NULL,
  risk_level         TEXT NOT NULL
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  operator_verdict   TEXT NOT NULL
    CHECK (operator_verdict IN ('approved','rejected','modified','ignored')),
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_tenant
  ON ai_decision_feedback(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_persona
  ON ai_decision_feedback(tenant_id, persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_turn
  ON ai_decision_feedback(tenant_id, turn_id);

CREATE TABLE IF NOT EXISTS ai_proactive_alerts (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_kind         TEXT NOT NULL
    CHECK (scope_kind IN ('property','unit','tenant','portfolio')),
  scope_id           TEXT NOT NULL,
  kind               TEXT NOT NULL,
  category           TEXT NOT NULL,
  severity           TEXT NOT NULL
    CHECK (severity IN ('critical','high','medium','low')),
  priority           INTEGER NOT NULL DEFAULT 3
    CHECK (priority BETWEEN 1 AND 3),
  title              TEXT NOT NULL,
  message            TEXT NOT NULL,
  evidence_refs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_plan        JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_points        JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_operator_action BOOLEAN NOT NULL DEFAULT FALSE,
  ack_at             TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_alerts_tenant
  ON ai_proactive_alerts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proactive_alerts_scope
  ON ai_proactive_alerts(tenant_id, scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_proactive_alerts_unresolved
  ON ai_proactive_alerts(tenant_id, resolved_at)
  WHERE resolved_at IS NULL;
