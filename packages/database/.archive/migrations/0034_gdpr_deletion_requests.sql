-- =============================================================================
-- 0032: GDPR right-to-be-forgotten requests — Wave 9 enterprise polish
-- =============================================================================
-- Tenant admins lodge a deletion request for a specific customer. A
-- super-admin then executes it, which pseudonymizes the customer's PII
-- across every referencing table — preserving referential integrity so
-- aggregate reporting (tenure, arrears, occupancy) remains accurate.
--
-- Full hard-delete would orphan decades of ledger/lease history; the
-- GDPR-recommended path for ongoing business records is pseudonymization.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gdpr_deletion_requests (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','rejected')),
  requested_by    TEXT NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_by     TEXT,
  executed_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  pseudonym_id    TEXT,             -- the [DELETED:<uuid>] marker assigned at execution
  affected_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_reqs_tenant
  ON gdpr_deletion_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_reqs_customer
  ON gdpr_deletion_requests(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_reqs_status
  ON gdpr_deletion_requests(status);
