-- =============================================================================
-- 0018: Approval Policies — per-tenant overrides
-- =============================================================================
-- Introduces the `approval_policies` table so each organization can override
-- the hardcoded default policies shipped in domain-services without losing
-- the defaults as a fallback floor. Composite primary key on (tenant_id, type)
-- ensures exactly one override per approval type per tenant.
--
-- This migration is purely additive: absence of a row means the service falls
-- back to getDefaultPolicyForType(...).
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_policies (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  policy_json JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  PRIMARY KEY (tenant_id, type)
);

CREATE INDEX IF NOT EXISTS approval_policies_tenant_idx
  ON approval_policies (tenant_id);

-- End of 0018
