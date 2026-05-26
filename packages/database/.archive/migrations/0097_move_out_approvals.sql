-- =============================================================================
-- 0097: Move-Out Checklists + Approval Requests (Wave 26 Agent Z3)
-- =============================================================================
-- Adds the two persistence tables needed to wire MoveOutChecklistService and
-- ApprovalService into the api-gateway composition root.
--
-- Both tables are multi-tenant (tenant_id column, indexed) and store the full
-- aggregate as JSONB alongside a handful of queryable columns. This mirrors
-- the approach used by 0018_approval_policies.sql and 0080_autonomous_mode:
-- the JSON blob is the source of truth; scalar columns are mirrors that
-- operators / analytics can filter on without unpacking JSON.
--
-- Idempotent: every statement uses IF NOT EXISTS. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------
-- move_out_checklists: one row per (tenant_id, lease_id).
-- Tracks the 4-step end-of-tenancy workflow: final inspection,
-- utility readings, deposit reconciliation, residency-proof letter.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS move_out_checklists (
  tenant_id         TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lease_id          TEXT        NOT NULL,
  checklist_json    JSONB       NOT NULL,
  is_finalized      BOOLEAN     NOT NULL DEFAULT FALSE,
  currency          TEXT        NOT NULL,
  total_deposit     NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, lease_id)
);

CREATE INDEX IF NOT EXISTS idx_move_out_checklists_tenant
  ON move_out_checklists (tenant_id);

CREATE INDEX IF NOT EXISTS idx_move_out_checklists_tenant_finalized
  ON move_out_checklists (tenant_id, is_finalized);

-- ---------------------------------------------------------------
-- approval_requests: pending / approved / rejected / escalated
-- approval workflow items. Paired with approval_policies (0018)
-- which stores per-tenant thresholds + approval chains.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_requests (
  id                     TEXT        PRIMARY KEY,
  tenant_id              TEXT        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type                   TEXT        NOT NULL,
  status                 TEXT        NOT NULL,
  requester_id           TEXT        NOT NULL,
  approver_id            TEXT        NULL,
  escalated_to_user_id   TEXT        NULL,
  amount                 NUMERIC(14,2) NULL,
  currency               TEXT        NULL,
  justification          TEXT        NOT NULL,
  details_json           JSONB       NOT NULL,
  comments               TEXT        NULL,
  rejection_reason       TEXT        NULL,
  escalation_reason      TEXT        NULL,
  approved_at            TIMESTAMPTZ NULL,
  rejected_at            TIMESTAMPTZ NULL,
  escalated_at           TIMESTAMPTZ NULL,
  timeout_at             TIMESTAMPTZ NULL,
  approval_level         INTEGER     NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             TEXT        NOT NULL,
  updated_by             TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant
  ON approval_requests (tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status
  ON approval_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_approver
  ON approval_requests (tenant_id, approver_id)
  WHERE approver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_escalated
  ON approval_requests (tenant_id, escalated_to_user_id)
  WHERE escalated_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_requester
  ON approval_requests (tenant_id, requester_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_type
  ON approval_requests (tenant_id, type);

-- End of 0097
