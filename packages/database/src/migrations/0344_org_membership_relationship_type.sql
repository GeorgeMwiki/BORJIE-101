-- =============================================================================
-- Migration 0344 — org_memberships: relationship_type discriminator + a
-- denormalized targeting member_role, so ONE membership row expresses BOTH a
-- worker's employment AND a buyer's connection, and the audience resolver can
-- target a role-class ("all safety officers", "every connected buyer") with a
-- single relationship query instead of the single-tenant JWT + candidates[0]
-- collapse.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The User⟷Membership⟷Org substrate already exists (identity.schema.ts:
-- tenant_identities = global principal, org_memberships = the per-org join,
-- invite_codes = the connect token) — created in 0305, RLS-scoped in 0336 —
-- but the join table is DARK: it carries only `status` (ACTIVE|LEFT|BLOCKED),
-- with no way to tell a worker's employment from a buyer's connection, and no
-- queryable role-class. The surface-completion engine (the bidirectional
-- owner→workforce→buyer cascade) needs both:
--
--   * relationship_type — the discriminator that lets the SAME table back both
--     the workforce app (employment|contractor) and the buyer app
--     (buyer_connection), plus guest. orgScope='connected' (buyers) vs a
--     workforce role-class fan become predicates over this column.
--
--   * member_role — a DENORMALIZED targeting label (role-class string, sourced
--     from invite_codes.default_role_id at join) so "notify every safety
--     officer in this org" is one indexed membership query. This is a
--     CLASSIFICATION/targeting label ONLY — it is NOT an authorization grant.
--     Authorization continues to resolve through the membership's 1:1 shadow
--     user_id → the platform tenant's `users` table + RLS, exactly as before;
--     this column never widens access.
--
-- TWO COLUMNS (both additive, on the existing org_memberships table)
--   * relationship_type org_membership_relationship_type NOT NULL
--       DEFAULT 'employment' — the fast-default backfills every pre-existing
--       row to 'employment' (the workforce default) with no table rewrite and
--       no NOT-NULL backfill hazard.
--   * member_role text NULL — the optional targeting label.
--
-- Two partial indexes back the audience-resolver hot paths:
--   * (organization_id, relationship_type) WHERE status='ACTIVE'
--   * (organization_id, member_role)        WHERE status='ACTIVE'
--
-- TENANT SCOPE (CLAUDE.md hard rule): UNCHANGED. org_memberships already
-- carries its FORCE-RLS policies from 0336 (scoped on platform_tenant_id);
-- adding columns + indexes does not touch RLS. No new policy is needed.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): the enum is created in a
-- guarded DO-block (CREATE TYPE has no IF NOT EXISTS); both columns use ADD
-- COLUMN IF NOT EXISTS; both indexes use CREATE INDEX IF NOT EXISTS. On a
-- fully-migrated DB this is a pure no-op. The one NOT NULL (relationship_type)
-- carries a DEFAULT, so there is no backfill hazard.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/repositories/org-membership.repository.ts
--   * packages/database/src/migrations/down/0344_down_org_membership_relationship_type.sql
-- =============================================================================

BEGIN;

-- The relationship discriminator. employment|contractor = workforce app;
-- buyer_connection = buyer app; guest = limited/pending. Guarded CREATE TYPE
-- (no IF NOT EXISTS form) keeps the migration a no-op on a migrated DB.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'org_membership_relationship_type'
  ) THEN
    CREATE TYPE org_membership_relationship_type AS ENUM (
      'employment',
      'buyer_connection',
      'contractor',
      'guest'
    );
  END IF;
END $$;

ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS relationship_type org_membership_relationship_type
    NOT NULL DEFAULT 'employment';

-- Denormalized targeting label ONLY (not an authz grant — see header).
ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS member_role text;

-- Audience-resolver hot paths: a role-class / relationship fan within an org
-- only ever considers ACTIVE memberships, so both indexes are partial.
CREATE INDEX IF NOT EXISTS org_memberships_org_relationship_active_idx
  ON org_memberships (organization_id, relationship_type)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS org_memberships_org_member_role_active_idx
  ON org_memberships (organization_id, member_role)
  WHERE status = 'ACTIVE';

COMMENT ON COLUMN org_memberships.relationship_type IS
  'Discriminates the membership: employment|contractor = workforce app, '
  'buyer_connection = buyer app, guest = limited. Lets one membership table '
  'back both the worker and buyer surfaces; the audience resolver targets '
  'orgScope=connected (buyers) vs a workforce role-class as predicates here.';

COMMENT ON COLUMN org_memberships.member_role IS
  'Denormalized role-class TARGETING label (sourced from '
  'invite_codes.default_role_id at join) so an audience fan ("all safety '
  'officers") is one indexed query. CLASSIFICATION ONLY — never an '
  'authorization grant; authz resolves via the shadow user_id + RLS.';

COMMIT;
