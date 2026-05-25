-- =============================================================================
-- 0112: Approval Grants (Wave 27 Agent D) — explicit human authorization layer
-- =============================================================================
-- Implements the user's mandate verbatim: "If something is going to be
-- autonomous, that's fine, but a human has to approve it for it to be
-- autonomous. And it's gonna be autonomous as a one-task or a repetitive task,
-- so that also has to be clarified."
--
-- Two kinds of grants:
--   - single_action: approves ONE specific instance of an action. Consumed
--     once (used_count goes 0 -> 1) and cannot be reused.
--   - standing_authorization: pre-authorizes an action category for repeated
--     autonomous execution within a bounded scope (amount ceiling, entity
--     type, count limit, time window). Every use increments used_count;
--     expiry and max_uses are enforced server-side using NOW() so clock
--     drift cannot bypass the limit.
--
-- Layering: grants sit ON TOP of AutonomyPolicyService. For an autonomous
-- action to run, BOTH gates must say yes:
--   1. autonomy-policy: domain-level rule allows the action
--   2. approval-grants: human-authorized grant (single or standing) exists
-- Revocation writes revoked_at and is enforced on the very next check.
-- =============================================================================

-- --- grants table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_grants (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL
                     CHECK (kind IN ('single_action', 'standing_authorization')),
  domain             TEXT NOT NULL
                     CHECK (domain IN (
                       'finance',
                       'leasing',
                       'maintenance',
                       'compliance',
                       'communications',
                       'marketing',
                       'hr',
                       'procurement',
                       'insurance',
                       'legal_proceedings',
                       'tenant_welfare'
                     )),
  action_category    TEXT NOT NULL,
  -- per-kind scope:
  --   single:    { targetEntityType: string, targetEntityId: string,
  --                amountMinorUnits?: number, meta?: object }
  --   standing:  { amountCeilingMinorUnits?: number,
  --                entityType?: string,
  --                entityIds?: string[] | null,   -- null = any entity
  --                maxPerDay?: number,
  --                meta?: object }
  scope_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to           TIMESTAMPTZ,                            -- null = open-ended
  used_count         INTEGER NOT NULL DEFAULT 0
                     CHECK (used_count >= 0),
  max_uses           INTEGER
                     CHECK (max_uses IS NULL OR max_uses > 0),
  notes              TEXT,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at         TIMESTAMPTZ,
  revoked_by         TEXT,
  revoke_reason      TEXT,
  CONSTRAINT approval_grants_single_max_uses_invariant
    CHECK (
      (kind = 'single_action' AND (max_uses IS NULL OR max_uses = 1))
      OR kind = 'standing_authorization'
    ),
  CONSTRAINT approval_grants_revoke_consistency
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- Fast lookup for the hot path: every task-agent run issues one authorization
-- check keyed on (tenant, action_category, kind).
CREATE INDEX IF NOT EXISTS idx_approval_grants_tenant_category
  ON approval_grants (tenant_id, action_category, kind, valid_from);

CREATE INDEX IF NOT EXISTS idx_approval_grants_active
  ON approval_grants (tenant_id, action_category)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_approval_grants_history
  ON approval_grants (tenant_id, created_at DESC);

-- Prevent creating a duplicate pending single-action grant for the same
-- tenant + action_category + target (target pulled from scope_json).
-- We use a partial unique index scoped to single_action grants that have
-- not yet been consumed — matches the user's "one-shot pending" model.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_approval_grants_pending_single
  ON approval_grants (
    tenant_id,
    action_category,
    (scope_json->>'targetEntityType'),
    (scope_json->>'targetEntityId')
  )
  WHERE kind = 'single_action'
    AND used_count = 0
    AND revoked_at IS NULL;

-- --- audit-linkable usage log ----------------------------------------------
-- Every consume() call writes a row here so the audit-trail-v2 surface (Agent
-- C) can project the full usage history of a grant without re-parsing the
-- grant row. The grant-service emits a domain event per consume that the
-- audit-trail-v2 subscriber picks up.
CREATE TABLE IF NOT EXISTS approval_grant_usages (
  id                 TEXT PRIMARY KEY,
  grant_id           TEXT NOT NULL REFERENCES approval_grants(id) ON DELETE CASCADE,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_ref         TEXT NOT NULL,                  -- idempotency key (e.g. task-agent runId)
  consumed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor              TEXT,                           -- system actor (task-agent id)
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uniq_approval_grant_usage_action_ref
    UNIQUE (grant_id, action_ref)
);

CREATE INDEX IF NOT EXISTS idx_approval_grant_usages_tenant_time
  ON approval_grant_usages (tenant_id, consumed_at DESC);
