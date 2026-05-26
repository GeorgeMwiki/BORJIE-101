-- =============================================================================
-- Migration 0013 — Piece B `routing_rules` + Piece E `executive_brief_actions`
--
-- Closes issues #39 (Piece B routing table) and #41 (Piece E action queue).
--
-- `routing_rules` lets the dispatcher route a finished junior's output to
-- the next junior in the chain (or escalate to a human role) under an
-- in-process JSONB condition predicate. Higher priority wins.
--
-- `executive_brief_actions` is the approved-actions queue that the
-- Piece E worker drains every 10 s (dev) — it executes each approved
-- action against the junior executor and persists the result.
--
-- Both tables are RLS-FORCED under the platform tenant_isolation policy
-- (`tenant_id = current_setting('app.tenant_id', true)`).
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. routing_rules — Piece B (junior → junior | human)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS routing_rules (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_kind     text NOT NULL,
  target_role     text NOT NULL,
  target_kind     text NOT NULL,
  condition_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority        smallint NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routing_rules_target_role_chk
    CHECK (target_role IN ('junior','human')),
  CONSTRAINT routing_rules_priority_chk
    CHECK (priority >= 0 AND priority <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant_source
  ON routing_rules(tenant_id, source_kind, active);
CREATE INDEX IF NOT EXISTS idx_routing_rules_priority
  ON routing_rules(tenant_id, source_kind, priority);

ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON routing_rules;
CREATE POLICY tenant_isolation ON routing_rules
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 2. executive_brief_actions — Piece E approved-actions queue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS executive_brief_actions (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brief_id      text,
  junior_name   text NOT NULL,
  intent        text NOT NULL,
  payload_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending',
  attempts      smallint NOT NULL DEFAULT 0,
  error_text    text,
  result_jsonb  jsonb,
  approved_at   timestamptz,
  executed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executive_brief_actions_status_chk
    CHECK (status IN ('pending','approved','executed','failed','rejected')),
  CONSTRAINT executive_brief_actions_attempts_chk
    CHECK (attempts >= 0 AND attempts <= 10)
);

CREATE INDEX IF NOT EXISTS idx_executive_brief_actions_tenant_status
  ON executive_brief_actions(tenant_id, status, executed_at);
CREATE INDEX IF NOT EXISTS idx_executive_brief_actions_brief
  ON executive_brief_actions(brief_id);

ALTER TABLE executive_brief_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_brief_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON executive_brief_actions;
CREATE POLICY tenant_isolation ON executive_brief_actions
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 3. Seed rows — borjie-demo tenant. Idempotent on (id).
--
-- These rules mirror the canonical mining-domain junior chain documented
-- in Docs/build/JUNIOR_CHAIN.md (lease watchers feed compliance, ore
-- intake triggers arrears check, safety incidents escalate to humans).
-- -----------------------------------------------------------------------------

INSERT INTO routing_rules
  (id, tenant_id, source_kind, target_role, target_kind, condition_jsonb, priority, active)
VALUES
  (
    'rr-borjie-demo-lease-renewal-to-compliance',
    'borjie-demo',
    'lease-renewal-watcher',
    'junior',
    'compliance-check-junior',
    '{"all":[{"path":"severity","op":"in","value":["HIGH","CRITICAL"]}]}'::jsonb,
    200,
    true
  ),
  (
    'rr-borjie-demo-ore-intake-to-arrears',
    'borjie-demo',
    'ore-intake-junior',
    'junior',
    'arrears-junior',
    '{}'::jsonb,
    150,
    true
  ),
  (
    'rr-borjie-demo-safety-to-human',
    'borjie-demo',
    'safety-incident-junior',
    'human',
    'site_safety_officer',
    '{"all":[{"path":"severity","op":"in","value":["HIGH","CRITICAL"]}]}'::jsonb,
    300,
    true
  ),
  (
    'rr-borjie-demo-arrears-escalate',
    'borjie-demo',
    'arrears-junior',
    'human',
    'finance_manager',
    '{"all":[{"path":"overdue_count","op":"gte","value":3}]}'::jsonb,
    250,
    true
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
