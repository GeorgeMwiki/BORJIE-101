-- ============================================================================
-- Migration 0167 — AOP registry (specs, regression sets, active versions).
--
-- Persistent backing for the `AOPRegistryStore` port declared in
-- `packages/central-intelligence/src/agent/aops/aop-registry.ts`. Three
-- sibling tables — append-only specs, overwrite-on-id regression sets,
-- and a flippable (id → active version) map.
--
-- Optional scope_tenant_id (NULL = platform-global) lets multi-tenant
-- deployments scope reads when the adapter constructor receives a tenant.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS.
-- Backwards-compatible: no destructive ALTERs.
-- ============================================================================

-- (id, version) compound PK, append-only.
CREATE TABLE IF NOT EXISTS aop_specs (
  id              TEXT NOT NULL,
  version         TEXT NOT NULL,
  scope_tenant_id TEXT,
  spec            JSONB NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, version)
);

CREATE INDEX IF NOT EXISTS idx_aop_specs_inserted_at
  ON aop_specs (inserted_at);

CREATE INDEX IF NOT EXISTS idx_aop_specs_scope
  ON aop_specs (scope_tenant_id);

-- Overwrite-on-id regression sets.
CREATE TABLE IF NOT EXISTS aop_regression_sets (
  id              TEXT PRIMARY KEY,
  scope_tenant_id TEXT,
  payload         JSONB NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aop_regression_sets_scope
  ON aop_regression_sets (scope_tenant_id);

-- Active-version map (id → active version). Flip independently of
-- insertion order so a regression failure doesn't auto-promote.
CREATE TABLE IF NOT EXISTS aop_active_versions (
  id              TEXT PRIMARY KEY,
  scope_tenant_id TEXT,
  version         TEXT NOT NULL,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_aop_active_versions_scope_id
  ON aop_active_versions (scope_tenant_id, id);

COMMENT ON TABLE aop_specs IS
  'Versioned, append-only Agent Operating Procedure specs. (id, version) PK.';
COMMENT ON TABLE aop_regression_sets IS
  'Regression suites that gate AOP promotion. Overwrite-on-id.';
COMMENT ON TABLE aop_active_versions IS
  'Currently active version per AOP id. Flipped independently of insertion order.';
