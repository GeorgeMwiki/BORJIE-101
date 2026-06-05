-- =============================================================================
-- Migration 0278 — Admin Superpowers Four-Eye Pending Approvals (mining).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Ported from the BossNyumba admin-superpowers stack (BN migration 0301),
-- retargeted real-estate → mining. Borjie already had the token-based
-- `admin.four_eye.initiate/approve` primitive and a `/admin/superpowers`
-- route that merely stamped `provenance.requires_four_eye` on `undo_journal`
-- — there was NO dedicated propose → approve → reject → list_pending bulk-
-- action queue, no reject/list-pending surface, and no DB-level same-actor
-- guard. This table is the PENDING half of the two-phase admin superpower
-- ledger that closes that gap:
--
--   Phase 1 (POST /api/v1/admin/superpowers/bulk-action with a HIGH verb):
--     Insert one row PER (target licence-holder, target entity) with
--     status='pending'. The proposing admin's actor_id is pinned. No
--     side effects fire yet.
--
--   Phase 2 (POST /api/v1/admin/superpowers/approve/:journalId):
--     A SECOND distinct admin actor approves. The row transitions to
--     status='applied', the approving actor_id is pinned, and the
--     entity-side mutation fires. Approval is REJECTED if the approver is
--     the same actor as the proposer (FOUR_EYE_SAME_ACTOR), enforced at
--     the route AND by the `admin_four_eye_distinct_actors_chk` CHECK
--     constraint below (defense in depth).
--
-- HIGH-risk admin verbs (require four-eye), mining-retargeted:
--   - suspend_licence_holder              — soft-suspend a licence holder
--   - reactivate_licence_holder           — reverse a prior suspension
--   - export_regulator_pack               — full regulator dump (PCCB)
--   - force_supply_agreement_termination  — admin override of an agreement
--   - force_password_reset                — operator-initiated reset
--   - bulk_archive_inspection_cases (>50) — mass archive of inspections
--
-- MEDIUM-risk admin verbs (audit-logged, single actor sufficient):
--   - bulk_send_announcement              — broadcast to operators
--   - bulk_archive_old_royalty_invoices   — housekeeping
--   - bulk_re_tag_sites                   — taxonomy reorg
--
-- The MEDIUM verbs DO NOT use this table; they append directly to
-- `undo_journal` with provenance.status='applied'.
--
-- TTL: pending rows expire 24h after creation (operator must re-propose if
-- not approved in time). A future nightly sweeper marks them
-- status='expired' so the FE chip shows a clear "this proposal lapsed"
-- state instead of silently disappearing.
--
-- FRESH-DB SAFETY / IDEMPOTENCY
-- -----------------------------
-- Every statement is guarded: CREATE TABLE IF NOT EXISTS, DO-blocks that
-- check pg_constraint before ADD CONSTRAINT, CREATE INDEX IF NOT EXISTS,
-- DROP-then-CREATE POLICY, and a pg_roles guard around the anon REVOKE. On
-- a fully-migrated DB this is a pure no-op; on a FRESH or partially-applied
-- DB it guarantees the queue-backed route handlers always have a correctly
-- secured table. It REFERENCES ONLY PRE-EXISTING CONSTRUCTS (no FK to any
-- table that might not exist; the journal_id is a soft reference to
-- undo_journal.id captured by the route, not a hard FK, so the table stands
-- up on a fresh DB regardless of migration ordering).
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (the canonical GUC the
--     api-gateway databaseMiddleware binds; NEVER the legacy app.tenant_id).
--   * REVOKE anon, guarded for vanilla Postgres / CI empty-PG (anon is a
--     Supabase-only role).
--   * Migrations are immutable + forward-only: this APPENDS a new numbered
--     file (next after the prior highest, 0277); it edits no shipped
--     migration. Safe to re-run.
--   * NO money columns live here — pure admin-workflow state.
--
-- Companion files:
--   - packages/database/src/schemas/admin-superpower-pending-approvals.schema.ts
--   - services/api-gateway/src/routes/admin/superpowers.hono.ts
--   - services/api-gateway/src/composition/brain-tools/admin-superpowers-tools.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- §1 — admin_superpower_pending_approvals.
--
-- One row per (target entity) for a HIGH-risk admin bulk verb. journal_id is
-- a SOFT reference to undo_journal.id (captured by the route, not a hard FK)
-- so the table stands up on a fresh DB regardless of migration ordering.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_superpower_pending_approvals (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id             uuid        NOT NULL,
  -- Tenant scope that owns the pending row — the proposing admin's tenant.
  -- The canonical app.current_tenant_id RLS policy gates visibility on THIS
  -- column.
  proposed_by_tenant_id  text        NOT NULL,
  -- Target licence-holder (or other tenant) the action acts on. NULL for
  -- cross-tenant actions like bulk_send_announcement.
  target_tenant_id       text,
  -- Free-form descriptor of the target entity, e.g.
  -- 'licence_holder:lh-acme' or 'supply_agreement:sa-7' or 'user:user-42'.
  target_entity_ref      text        NOT NULL,
  -- The verb (suspend_licence_holder, force_supply_agreement_termination, …).
  action                 text        NOT NULL,
  -- Free-form payload for the verb (effective_date, etc.).
  payload                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Mandatory reason; surfaced in the approver's notification.
  reason                 text        NOT NULL,
  -- Lifecycle: pending → applied | rejected | expired.
  status                 text        NOT NULL DEFAULT 'pending',
  proposed_by_actor_id   text        NOT NULL,
  proposed_by_role       text        NOT NULL,
  approved_by_actor_id   text,
  approved_by_role       text,
  approver_note          text,
  rejected_by_actor_id   text,
  rejected_by_role       text,
  rejection_reason       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  approved_at            timestamptz,
  rejected_at            timestamptz,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  -- Audit chain ids (reference ai_audit_chain) — pinned at creation,
  -- appended again on approval/rejection by the route handler.
  audit_chain_ids        jsonb       NOT NULL DEFAULT '[]'::jsonb
);

-- -----------------------------------------------------------------------------
-- §2 — CHECK constraints (guarded so a re-run never errors).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'admin_four_eye_status_chk'
  ) THEN
    ALTER TABLE admin_superpower_pending_approvals
      ADD CONSTRAINT admin_four_eye_status_chk
      CHECK (status IN ('pending', 'applied', 'rejected', 'expired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'admin_four_eye_role_chk'
  ) THEN
    -- Borjie admin roles (matches services/api-gateway/src/types/user-role.ts).
    ALTER TABLE admin_superpower_pending_approvals
      ADD CONSTRAINT admin_four_eye_role_chk
      CHECK (proposed_by_role IN ('SUPER_ADMIN', 'ADMIN', 'SUPPORT'));
  END IF;

  -- Approver MUST differ from proposer (the FOUR-EYE invariant). The route
  -- refuses earlier with a structured 409 FOUR_EYE_SAME_ACTOR; this is the
  -- DB-level safety net.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'admin_four_eye_distinct_actors_chk'
  ) THEN
    ALTER TABLE admin_superpower_pending_approvals
      ADD CONSTRAINT admin_four_eye_distinct_actors_chk
      CHECK (
        approved_by_actor_id IS NULL
        OR approved_by_actor_id <> proposed_by_actor_id
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — indexes (IF NOT EXISTS keeps every one a no-op on re-run).
-- -----------------------------------------------------------------------------

-- Pending-queue path: operators load all pending for their tenant scope
-- newest first.
CREATE INDEX IF NOT EXISTS admin_four_eye_tenant_status_created_idx
  ON admin_superpower_pending_approvals (proposed_by_tenant_id, status, created_at DESC);

-- Journal-id lookup path (single-row fetch by approver).
CREATE INDEX IF NOT EXISTS admin_four_eye_journal_idx
  ON admin_superpower_pending_approvals (journal_id);

-- Expiry sweeper path.
CREATE INDEX IF NOT EXISTS admin_four_eye_expires_idx
  ON admin_superpower_pending_approvals (expires_at)
  WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- §4 — FORCE RLS + tenant-isolation policy on the CANONICAL GUC.
--
-- The proposing admin's tenant (proposed_by_tenant_id) is the gate. The
-- approving admin acts from the same admin tenant scope. proposed_by_tenant_id
-- is TEXT so the compare is bare (no cast). FOR ALL covers the pending
-- INSERT, the approve/reject UPDATE, and the list-pending SELECT. Idempotent:
-- ENABLE / FORCE are no-ops if already set; the policy is DROP-then-CREATE so
-- a re-run lands the canonical-GUC definition. Defense in depth: the route's
-- own requireRole(SUPER_ADMIN|ADMIN|SUPPORT) middleware refuses non-admins
-- BEFORE this policy is evaluated.
-- -----------------------------------------------------------------------------

ALTER TABLE admin_superpower_pending_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_superpower_pending_approvals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_four_eye_tenant_isolation
  ON admin_superpower_pending_approvals;
CREATE POLICY admin_four_eye_tenant_isolation
  ON admin_superpower_pending_approvals
  FOR ALL
  USING (proposed_by_tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (proposed_by_tenant_id = current_setting('app.current_tenant_id', true));

-- anon is a Supabase construct; guard so the migration still applies on a
-- vanilla Postgres (CI empty-PG check / non-Supabase env).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.admin_superpower_pending_approvals FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE admin_superpower_pending_approvals IS
  'Admin four-eye superpowers queue (migration 0278; ported from BN 0301, '
  'retargeted real-estate -> mining). PENDING half of the two-phase admin '
  'bulk-action ledger: HIGH-risk verbs (suspend_licence_holder / '
  'export_regulator_pack / force_supply_agreement_termination / force_'
  'password_reset / reactivate_licence_holder / bulk_archive_inspection_cases) '
  'land as pending rows a SECOND distinct admin must approve. Same-actor guard '
  'is admin_four_eye_distinct_actors_chk. Tenant-scoped FORCE RLS on the '
  'canonical app.current_tenant_id GUC. NO money columns.';

COMMIT;
