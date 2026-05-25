-- =============================================================================
-- 0128: Four-eye approval — declarative policy table with role groups.
--
-- K5 parity uplift. The kernel's `four-eye-approval.ts` currently hard-codes
-- "any 2 distinct approvers". LITFIN's `ApprovalPolicy` (types.ts:78-88) is
-- richer: per-action_type the operator declares HOW MANY approvers AND from
-- WHICH role groups, the auto-reject TTL window, the recall window, and
-- whether re-authentication is required.
--
-- The existing `approval_policies` rows in the codebase (migration TBD,
-- referenced from default-policies.ts) cover the property-management business
-- approvals (maintenance_cost / refund / discount / lease_exception /
-- payment_flexibility). This migration ADDS a parallel table scoped to the
-- sovereign-tier kernel `tool_name` namespace — these are AI-proposed actions,
-- not human-initiated business overrides.
--
-- Tenant scope: NULL `tenant_id` means platform-wide default; per-tenant rows
-- override the platform default. The service reads platform default ∪ tenant
-- override and the tenant row wins on conflict.
--
-- Role-group semantics:
--   role_groups is a JSONB array of group objects:
--     [
--       { "name": "compliance",     "minApprovers": 1 },
--       { "name": "ops",            "minApprovers": 1 },
--       { "name": "owner-relations","minApprovers": 1 }
--     ]
--   "any 2 admins" → [{ name: "admin", minApprovers: 2 }]
--   "1 compliance AND 1 ops" → [{ name: "compliance", minApprovers: 1 },
--                               { name: "ops",        minApprovers: 1 }]
--   The sum of minApprovers across groups MUST equal `min_total_approvers`
--   (defensive check in the service layer).
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_policy_actions (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  -- The kernel `tool_name` this policy governs (e.g. `eviction.propose`,
  -- `owner_payout.disburse`, `kra.file_mri_return`). NULL `tenant_id` + a given
  -- `action_type` is the platform default.
  action_type              TEXT NOT NULL,
  -- Sum of role_groups[*].minApprovers — denormalised so the service can
  -- short-circuit the "do we have enough total signatures yet?" check without
  -- walking the JSONB.
  min_total_approvers      INTEGER NOT NULL CHECK (min_total_approvers >= 1 AND min_total_approvers <= 5),
  -- Per-role-group quorum (see file header).
  role_groups              JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- How long the approval window stays open. After this elapses without the
  -- quorum being met, the request transitions to 'expired'. Maps to LITFIN's
  -- `autoRejectAfterHours` (types.ts:85). Default 24h matches the kernel's
  -- current hard-coded `DEFAULT_TTL_MS`.
  max_stale_minutes        INTEGER NOT NULL DEFAULT 1440 CHECK (max_stale_minutes > 0),
  -- How long after a proposer fires the request they can RECALL it. Zero =
  -- not recallable. Maps to LITFIN's `recallWindowMinutes` (types.ts:87).
  recall_window_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (recall_window_minutes >= 0),
  -- When TRUE, every approver must satisfy a fresh re-authentication step
  -- (TOTP / WebAuthn) within `re_auth_max_age_seconds` of signing. Maps to
  -- LITFIN's destructive-action-engine `reAuthVerified` requirement.
  re_auth_required         BOOLEAN NOT NULL DEFAULT FALSE,
  re_auth_max_age_seconds  INTEGER NOT NULL DEFAULT 300 CHECK (re_auth_max_age_seconds > 0),
  -- Whether the proposer is allowed to sign as one of the approvers. Default
  -- FALSE — matches the kernel's existing self-approval block.
  allow_proposer_signature BOOLEAN NOT NULL DEFAULT FALSE,
  -- Free-form operator notes (compliance ref, board minute, etc.).
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               TEXT
);

-- A given (tenant_id, action_type) pair has at most one policy row.
-- NULL tenant_id is the platform default; a tenant-scoped row of the same
-- action_type overrides it. PostgreSQL's UNIQUE treats NULLs as distinct,
-- so platform default + per-tenant rows coexist naturally.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_policy_actions_tenant_action
  ON approval_policy_actions (tenant_id, action_type);

-- Hot path: "give me the policy for tool_name X, tenant T". Two index hits
-- (tenant + platform-default) cover the resolution path with two index seeks.
CREATE INDEX IF NOT EXISTS idx_approval_policy_actions_action
  ON approval_policy_actions (action_type);

CREATE INDEX IF NOT EXISTS idx_approval_policy_actions_tenant
  ON approval_policy_actions (tenant_id) WHERE tenant_id IS NOT NULL;

COMMENT ON TABLE approval_policy_actions IS
  'K5 parity — declarative four-eye approval policy. One row per (tenant_id, action_type); NULL tenant = platform default. Drives the kernel-side ApprovalPolicy port in packages/database/src/services/approval-policy.service.ts.';

COMMENT ON COLUMN approval_policy_actions.role_groups IS
  'JSONB array of { name: string, minApprovers: integer }. Sum of minApprovers must equal min_total_approvers.';
