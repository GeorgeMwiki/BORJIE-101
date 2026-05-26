-- =============================================================================
-- Migration 0054 — Agent Security Guard (SEC-4)
--
-- Spec: Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md
--
-- Adds the persistence substrate for SEC-4 / Mr. Mwikila's AI-agent security
-- guard. Five tenant-scoped tables capture prompt-injection attempts,
-- tool-use violations, output-filter blocks, generic security signals, and
-- red-team scenario runs. Every table is multi-tenant via the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + guarded DO blocks). Safe to re-run.
--
-- Five tables:
--   1. prompt_injection_attempts — direct + indirect injection detections,
--                                   redacted input retained for forensics.
--   2. tool_use_violations       — every rejected tool call from the
--                                   sandbox (authority tier escalation,
--                                   schema violation, etc.).
--   3. output_filter_blocks      — outputs scrubbed of markdown-image
--                                   exfil, PII, system-prompt leak, etc.
--   4. agent_security_signals    — generic catch-all signal stream feeding
--                                   the dispatch-router for on-call paging.
--   5. red_team_runs             — daily CI scenario-runner results with
--                                   attacks_attempted / blocked / succeeded
--                                   counts.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. prompt_injection_attempts — direct + indirect injection detections
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prompt_injection_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  user_id         text,
  channel         text NOT NULL,
  raw_input       text NOT NULL,
  redacted_input  text NOT NULL,
  attack_kind     text NOT NULL,
  severity        text NOT NULL,
  blocked         boolean NOT NULL DEFAULT true,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  prev_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prompt_injection_attempts_severity_chk'
  ) THEN
    ALTER TABLE prompt_injection_attempts
      ADD CONSTRAINT prompt_injection_attempts_severity_chk
      CHECK (severity IN ('low', 'medium', 'high', 'critical'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prompt_injection_attempts_tenant
  ON prompt_injection_attempts (tenant_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_injection_attempts_kind
  ON prompt_injection_attempts (tenant_id, attack_kind, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_injection_attempts_severity
  ON prompt_injection_attempts (tenant_id, severity, detected_at DESC);

ALTER TABLE prompt_injection_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prompt_injection_attempts_tenant_read ON prompt_injection_attempts;
CREATE POLICY prompt_injection_attempts_tenant_read ON prompt_injection_attempts
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE prompt_injection_attempts IS
  'SEC-4 — direct + indirect prompt-injection detection records. Severity in (low, medium, high, critical). Hash-chained for tamper evidence.';

-- -----------------------------------------------------------------------------
-- 2. tool_use_violations — rejected tool calls from the sandbox
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tool_use_violations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  agent_kind      text NOT NULL,
  tool_name       text NOT NULL,
  attempted_args  jsonb NOT NULL DEFAULT '{}'::jsonb,
  violation_kind  text NOT NULL,
  blocked         boolean NOT NULL DEFAULT true,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tool_use_violations_kind_chk'
  ) THEN
    ALTER TABLE tool_use_violations
      ADD CONSTRAINT tool_use_violations_kind_chk
      CHECK (violation_kind IN (
        'authority_escalation',
        'unknown_tool',
        'schema_violation',
        'missing_confirmation',
        'recursion_limit',
        'cross_tenant',
        'rate_limit'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tool_use_violations_tenant
  ON tool_use_violations (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_use_violations_tool
  ON tool_use_violations (tenant_id, tool_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_use_violations_kind
  ON tool_use_violations (tenant_id, violation_kind, occurred_at DESC);

ALTER TABLE tool_use_violations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_use_violations_tenant_read ON tool_use_violations;
CREATE POLICY tool_use_violations_tenant_read ON tool_use_violations
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE tool_use_violations IS
  'SEC-4 — rejected tool-call attempts. Violation kind covers authority escalation, unknown tools, schema violations, missing confirmation, recursion, cross-tenant, rate limit.';

-- -----------------------------------------------------------------------------
-- 3. output_filter_blocks — scrubbed outputs (markdown-image, PII, etc.)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS output_filter_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  channel         text NOT NULL,
  output_excerpt  text NOT NULL,
  filter_rule     text NOT NULL,
  blocked_at      timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_output_filter_blocks_tenant
  ON output_filter_blocks (tenant_id, blocked_at DESC);

CREATE INDEX IF NOT EXISTS idx_output_filter_blocks_rule
  ON output_filter_blocks (tenant_id, filter_rule, blocked_at DESC);

ALTER TABLE output_filter_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS output_filter_blocks_tenant_read ON output_filter_blocks;
CREATE POLICY output_filter_blocks_tenant_read ON output_filter_blocks
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE output_filter_blocks IS
  'SEC-4 — output sanitisation events. Covers markdown-image exfil, PII leakage, system-prompt leakage, JS-injection blocks.';

-- -----------------------------------------------------------------------------
-- 4. agent_security_signals — generic signal stream
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_security_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  signal_kind     text NOT NULL,
  severity        text NOT NULL,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_security_signals_severity_chk'
  ) THEN
    ALTER TABLE agent_security_signals
      ADD CONSTRAINT agent_security_signals_severity_chk
      CHECK (severity IN ('low', 'medium', 'high', 'critical'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_security_signals_tenant
  ON agent_security_signals (tenant_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_security_signals_kind
  ON agent_security_signals (tenant_id, signal_kind, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_security_signals_severity
  ON agent_security_signals (tenant_id, severity, recorded_at DESC);

ALTER TABLE agent_security_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_security_signals_tenant_read ON agent_security_signals;
CREATE POLICY agent_security_signals_tenant_read ON agent_security_signals
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE agent_security_signals IS
  'SEC-4 — generic AI-agent security signal stream. Feeds dispatch-router for on-call paging. Severity in (low, medium, high, critical).';

-- -----------------------------------------------------------------------------
-- 5. red_team_runs — scenario-runner results
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS red_team_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL,
  scenario           text NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  attacks_attempted  integer NOT NULL DEFAULT 0,
  attacks_blocked    integer NOT NULL DEFAULT 0,
  attacks_succeeded  integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'running',
  audit_hash         text NOT NULL,
  prev_hash          text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'red_team_runs_status_chk'
  ) THEN
    ALTER TABLE red_team_runs
      ADD CONSTRAINT red_team_runs_status_chk
      CHECK (status IN ('running', 'passed', 'failed', 'error', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'red_team_runs_counts_chk'
  ) THEN
    ALTER TABLE red_team_runs
      ADD CONSTRAINT red_team_runs_counts_chk
      CHECK (
        attacks_attempted >= 0
        AND attacks_blocked >= 0
        AND attacks_succeeded >= 0
        AND attacks_blocked + attacks_succeeded <= attacks_attempted
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_red_team_runs_tenant
  ON red_team_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_red_team_runs_scenario
  ON red_team_runs (tenant_id, scenario, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_red_team_runs_status
  ON red_team_runs (tenant_id, status, started_at DESC);

ALTER TABLE red_team_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS red_team_runs_tenant_read ON red_team_runs;
CREATE POLICY red_team_runs_tenant_read ON red_team_runs
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE red_team_runs IS
  'SEC-4 — daily red-team scenario-runner outcomes. CI fails build if attacks_succeeded > 0 at severity >= high.';

COMMIT;
