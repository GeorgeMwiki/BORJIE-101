-- =============================================================================
-- Migration 0023 — Mutation Authority (Wave 18S)
--
-- Implements `Docs/DESIGN/MUTATION_AUTHORITY_SPEC.md`. Five tables back
-- the WRITE side of universal MD power:
--
--   1. mutation_recipes              — platform-level recipe registry
--   2. mutation_proposals            — tenant-scoped, pending → terminal
--   3. mutation_approvals            — owner + second-authoriser sigs
--   4. mutation_history              — append-only result ledger
--   5. second_authoriser_assignments — per-tenant double-verify pairing
--
-- RLS policies are tenant-scoped on every tenant-bearing table, mirroring
-- the existing pattern from `0009_killswitch_rbac.sql`. The mutation_recipes
-- table is global and read-only to JWT clients — writes go through the
-- admin platform tooling.
--
-- Idempotent (`IF NOT EXISTS`). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. mutation_recipes — platform-level registry
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mutation_recipes (
  id                    text        NOT NULL,
  version               integer     NOT NULL,
  status                text        NOT NULL,
  class                 text        NOT NULL,
  authority_tier        smallint    NOT NULL,
  is_critical           boolean     NOT NULL DEFAULT false,
  reversibility         text        NOT NULL,
  compose_fn_ref        text        NOT NULL,
  execute_fn_ref        text        NOT NULL,
  required_citations    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  brand                 text        NOT NULL DEFAULT 'borjie',
  promoted_at           timestamptz,
  locked_at             timestamptz,
  PRIMARY KEY (id, version),
  CONSTRAINT mutation_recipes_class_chk
    CHECK (class IN ('ui', 'data', 'document', 'action')),
  CONSTRAINT mutation_recipes_status_chk
    CHECK (status IN ('draft', 'shadow', 'live', 'locked', 'deprecated')),
  CONSTRAINT mutation_recipes_tier_chk
    CHECK (authority_tier BETWEEN 0 AND 2),
  CONSTRAINT mutation_recipes_reversibility_chk
    CHECK (reversibility IN ('fully', 'partial', 'irreversible'))
);

CREATE INDEX IF NOT EXISTS mutation_recipes_status_idx
  ON mutation_recipes(status);
CREATE INDEX IF NOT EXISTS mutation_recipes_class_idx
  ON mutation_recipes(class);

-- -----------------------------------------------------------------------------
-- 2. mutation_proposals — tenant-scoped, pending → terminal
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mutation_proposals (
  id                                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         text        NOT NULL,
  recipe_id                         text        NOT NULL,
  recipe_version                    integer     NOT NULL,
  proposed_by                       text        NOT NULL,
  proposed_at                       timestamptz NOT NULL DEFAULT now(),
  subject                           jsonb       NOT NULL,
  preview                           jsonb       NOT NULL,
  research_evidence_ids             text[]      NOT NULL DEFAULT '{}',
  cost_or_value_at_stake_usd_cents  bigint      NOT NULL DEFAULT 0,
  reversibility                     text        NOT NULL,
  authority_tier                    smallint    NOT NULL,
  requires_double_verify            boolean     NOT NULL DEFAULT false,
  expires_at                        timestamptz NOT NULL,
  status                            text        NOT NULL DEFAULT 'pending',
  audit_hash                        text        NOT NULL,
  CONSTRAINT mutation_proposals_status_chk
    CHECK (status IN ('pending', 'approved_primary', 'approved_full',
                      'rejected', 'executed', 'aborted', 'expired')),
  CONSTRAINT mutation_proposals_tier_chk
    CHECK (authority_tier BETWEEN 0 AND 2),
  CONSTRAINT mutation_proposals_reversibility_chk
    CHECK (reversibility IN ('fully', 'partial', 'irreversible'))
);

CREATE INDEX IF NOT EXISTS mutation_proposals_tenant_status_idx
  ON mutation_proposals(tenant_id, status);
CREATE INDEX IF NOT EXISTS mutation_proposals_recipe_idx
  ON mutation_proposals(recipe_id, recipe_version);
CREATE INDEX IF NOT EXISTS mutation_proposals_expires_idx
  ON mutation_proposals(expires_at)
  WHERE status IN ('pending', 'approved_primary');

-- -----------------------------------------------------------------------------
-- 3. mutation_approvals — owner + second-authoriser sigs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mutation_approvals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid        NOT NULL REFERENCES mutation_proposals(id) ON DELETE CASCADE,
  approver_user_id    text        NOT NULL,
  approver_role       text        NOT NULL,
  decision            text        NOT NULL,
  reasoning           text        NOT NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text        NOT NULL,
  CONSTRAINT no_self_double_approve
    UNIQUE (proposal_id, approver_user_id),
  CONSTRAINT mutation_approvals_role_chk
    CHECK (approver_role IN ('owner', 'second_authoriser')),
  CONSTRAINT mutation_approvals_decision_chk
    CHECK (decision IN ('approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS mutation_approvals_proposal_idx
  ON mutation_approvals(proposal_id);
CREATE INDEX IF NOT EXISTS mutation_approvals_approver_idx
  ON mutation_approvals(approver_user_id);

-- -----------------------------------------------------------------------------
-- 4. mutation_history — append-only result ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mutation_history (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id              uuid        NOT NULL UNIQUE REFERENCES mutation_proposals(id) ON DELETE RESTRICT,
  status                   text        NOT NULL,
  executed_at              timestamptz NOT NULL DEFAULT now(),
  rollback_token           text,
  side_effects_summary     text        NOT NULL,
  downstream_artifacts     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  audit_hash               text        NOT NULL,
  CONSTRAINT mutation_history_status_chk
    CHECK (status IN ('executed', 'failed', 'aborted'))
);

CREATE INDEX IF NOT EXISTS mutation_history_proposal_idx
  ON mutation_history(proposal_id);
CREATE INDEX IF NOT EXISTS mutation_history_status_idx
  ON mutation_history(status);

-- -----------------------------------------------------------------------------
-- 5. second_authoriser_assignments — per-tenant double-verify pairing
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS second_authoriser_assignments (
  tenant_id                  text        NOT NULL,
  primary_user_id            text        NOT NULL,
  second_authoriser_user_id  text        NOT NULL,
  assigned_at                timestamptz NOT NULL DEFAULT now(),
  active                     boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, primary_user_id),
  CONSTRAINT distinct_primary_and_second
    CHECK (primary_user_id <> second_authoriser_user_id)
);

CREATE INDEX IF NOT EXISTS second_authoriser_tenant_idx
  ON second_authoriser_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS second_authoriser_active_idx
  ON second_authoriser_assignments(tenant_id, active);

-- -----------------------------------------------------------------------------
-- 6. RLS policies — tenant-scoped reads on every tenant-bearing table
-- -----------------------------------------------------------------------------

ALTER TABLE mutation_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mutation_proposals_tenant_read ON mutation_proposals;
CREATE POLICY mutation_proposals_tenant_read ON mutation_proposals
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE mutation_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mutation_approvals_tenant_read ON mutation_approvals;
CREATE POLICY mutation_approvals_tenant_read ON mutation_approvals
  USING (
    EXISTS (
      SELECT 1
      FROM mutation_proposals p
      WHERE p.id = mutation_approvals.proposal_id
        AND p.tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE mutation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mutation_history_tenant_read ON mutation_history;
CREATE POLICY mutation_history_tenant_read ON mutation_history
  USING (
    EXISTS (
      SELECT 1
      FROM mutation_proposals p
      WHERE p.id = mutation_history.proposal_id
        AND p.tenant_id = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE second_authoriser_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS second_authoriser_tenant_read ON second_authoriser_assignments;
CREATE POLICY second_authoriser_tenant_read ON second_authoriser_assignments
  USING (tenant_id = current_setting('app.tenant_id', true));

-- mutation_recipes is global (platform-level) — readable by all
-- authenticated JWTs, writable only by SUPER_ADMIN at the API layer.
-- No tenant predicate.

COMMIT;
