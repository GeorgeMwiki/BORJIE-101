-- =============================================================================
-- 0240: Fix Piece E action_quotas + approval_matrix_dsl_compiled PK/UNIQUE
--
-- 0227_action_quotas.sql + 0228_approval_matrix_dsl_compiled.sql both used
-- the same invalid pattern as the original 0187:
--     PRIMARY KEY (..., COALESCE(col, ''), ...)
-- Postgres does not allow function calls in PRIMARY KEY / UNIQUE column lists
-- — only in UNIQUE INDEX expressions.
-- This migration recreates the two tables with PK on `id` and a UNIQUE INDEX
-- with the COALESCE expression on the appropriate columns.
-- =============================================================================

-- Drop any partial state from the failed attempts.
DROP TABLE IF EXISTS action_quotas CASCADE;
DROP TABLE IF EXISTS approval_matrix_dsl_compiled CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- action_quotas — per-tenant + per-persona per-day caps on actions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE action_quotas (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id      text,                -- nullable = tenant-wide
  period_date     date NOT NULL,
  quota_kind      text NOT NULL,       -- 'draft', 'execute', 'money_mutation'
  cap_count       integer NOT NULL,
  used_count      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX action_quotas_tenant_persona_day_kind_uniq
  ON action_quotas (tenant_id, COALESCE(persona_id, '__tenant_wide__'), period_date, quota_kind);

CREATE INDEX action_quotas_tenant_date_idx
  ON action_quotas (tenant_id, period_date DESC);

ALTER TABLE action_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_quotas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON action_quotas;
CREATE POLICY tenant_isolation_select ON action_quotas FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON action_quotas;
CREATE POLICY tenant_isolation_modify ON action_quotas FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
REVOKE ALL ON action_quotas FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_quotas TO authenticated, service_role;

COMMENT ON TABLE action_quotas IS 'Piece E — per-tenant + per-persona daily action caps (LOW/MED/HIGH/SOVEREIGN tiers).';

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_matrix_dsl_compiled — compiled rule cache from the DSL
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE approval_matrix_dsl_compiled (
  id                  text PRIMARY KEY,
  tenant_id           text REFERENCES tenants(id) ON DELETE CASCADE,  -- nullable = platform default rule
  rule_slug           text NOT NULL,
  source_dsl          text NOT NULL,
  compiled_jsonb      jsonb NOT NULL,
  version             smallint NOT NULL DEFAULT 1,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX approval_matrix_dsl_compiled_tenant_slug_uniq
  ON approval_matrix_dsl_compiled (COALESCE(tenant_id, '__platform__'), rule_slug)
  WHERE active = true;

CREATE INDEX approval_matrix_dsl_compiled_tenant_idx
  ON approval_matrix_dsl_compiled (tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE approval_matrix_dsl_compiled ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_matrix_dsl_compiled FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON approval_matrix_dsl_compiled;
CREATE POLICY tenant_isolation_select ON approval_matrix_dsl_compiled FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON approval_matrix_dsl_compiled;
CREATE POLICY tenant_isolation_modify ON approval_matrix_dsl_compiled FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
REVOKE ALL ON approval_matrix_dsl_compiled FROM anon;
GRANT SELECT ON approval_matrix_dsl_compiled TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON approval_matrix_dsl_compiled TO service_role;

COMMENT ON TABLE approval_matrix_dsl_compiled IS 'Piece E — compiled approval-matrix DSL rules. Platform rules (tenant_id NULL) visible to all tenants.';
