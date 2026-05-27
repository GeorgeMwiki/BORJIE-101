-- =============================================================================
-- Migration 0086 — Workforce Invitations (Wave WORKFORCE-INVITES)
--
-- Companion to:
--   - services/api-gateway/src/routes/workforce/invites.hono.ts
--   - packages/database/src/schemas/workforce-invitations.schema.ts
--   - apps/owner-web/src/components/workforce/InviteWorkerForm.tsx
--   - apps/workforce-mobile/src/components/workforce/InviteWorkerSheet.tsx
--   - apps/workforce-mobile/app/auth/activate.tsx
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Workers do NOT self-sign-up. Owners (or managers, when delegated) issue
-- an invitation containing a 6-digit activation code. The invited worker
-- receives the code via SMS / WhatsApp, opens the workforce-mobile
-- "activate" screen, and submits {phone, code}. On success a Supabase
-- user is provisioned (or linked) with `app_metadata.tenant_id` +
-- `app_metadata.mining_role` claims and granted employee (or manager)
-- access to the inviting tenant only.
--
-- Single table — `workforce_invitations`:
--   - 6-digit activation_code, expires_at (default 14d).
--   - assigned_role: employee|manager (owner can also invite a manager).
--   - assigned_site_id, assigned_certifications (JSONB array of certs
--     from packages/mining-shift-planner Certification enum).
--   - Status lifecycle: pending -> activated | expired | revoked.
--   - hash_chain_id links each lifecycle transition to ai_audit_chain
--     (CLAUDE.md "AI audit chain is hash-chained, append-only").
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`) so the policy applies to table owners too.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- workforce_invitations — owner/admin invites worker; worker activates
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_invitations (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL,
  /** Owner / admin / manager who issued this invitation. */
  invited_by_user_id       uuid        NOT NULL,
  /** Optional human-readable label so the inviter can recognise the row
   *  in the pending list (e.g. "John the new haul-truck driver"). */
  full_name                text,
  /** ITU-T E.164 phone (incl. leading +). One-pending-per-phone-per-tenant. */
  phone_e164               text        NOT NULL,
  /** 6-digit activation code (random). Stored as text to preserve leading zeros. */
  activation_code          text        NOT NULL,
  /** employee|manager — owner may delegate manager seats. */
  assigned_role            text        NOT NULL DEFAULT 'employee',
  /** Optional site assignment (workforce-mobile defaults to it on first login). */
  assigned_site_id         uuid,
  /** JSONB array of certification strings from
   *  packages/mining-shift-planner Certification enum. */
  assigned_certifications  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** TTL — invitation expires after this point and cannot be activated. */
  expires_at               timestamptz NOT NULL,
  /** Stamped on successful activation (also flips status). */
  activated_at             timestamptz,
  /** Supabase user id chosen / created on activation. */
  activated_user_id        uuid,
  /** pending|activated|expired|revoked. */
  status                   text        NOT NULL DEFAULT 'pending',
  created_at               timestamptz NOT NULL DEFAULT now(),
  /** Hash-chained audit-trail link (issue + activate + revoke). */
  hash_chain_id            uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_invitations_status_chk'
  ) THEN
    ALTER TABLE workforce_invitations
      ADD CONSTRAINT workforce_invitations_status_chk
      CHECK (status IN ('pending', 'activated', 'expired', 'revoked'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_invitations_role_chk'
  ) THEN
    ALTER TABLE workforce_invitations
      ADD CONSTRAINT workforce_invitations_role_chk
      CHECK (assigned_role IN ('employee', 'manager'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_invitations_code_format_chk'
  ) THEN
    ALTER TABLE workforce_invitations
      ADD CONSTRAINT workforce_invitations_code_format_chk
      CHECK (activation_code ~ '^[0-9]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workforce_invitations_phone_e164_chk'
  ) THEN
    ALTER TABLE workforce_invitations
      ADD CONSTRAINT workforce_invitations_phone_e164_chk
      CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$');
  END IF;
END $$;

-- Hot path: inviter pulls "pending" list — newest first.
CREATE INDEX IF NOT EXISTS idx_workforce_invitations_tenant_status_created
  ON workforce_invitations (tenant_id, status, created_at DESC);

-- Activation lookup: worker submits (phone, code).
CREATE INDEX IF NOT EXISTS idx_workforce_invitations_phone
  ON workforce_invitations (phone_e164, status);

-- Expiry scan (cron promotes pending -> expired).
CREATE INDEX IF NOT EXISTS idx_workforce_invitations_expires_at
  ON workforce_invitations (expires_at)
  WHERE status = 'pending';

-- One-pending-per-phone-per-tenant — re-invites within the window collapse
-- to the existing row. NULL-safe via the partial-unique pattern.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_invitations_tenant_phone_pending
  ON workforce_invitations (tenant_id, phone_e164)
  WHERE status = 'pending';

ALTER TABLE workforce_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_invitations FORCE ROW LEVEL SECURITY;

-- Tenant-isolation: the api-gateway databaseMiddleware sets
-- app.tenant_id to the JWT tenant on every request. For activation
-- (which is an unauthenticated route), the route bypasses the GUC by
-- using a service-role connection; the table policy still protects
-- every authenticated read/write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workforce_invitations'
       AND policyname = 'workforce_invitations_tenant_isolation'
  ) THEN
    CREATE POLICY workforce_invitations_tenant_isolation
      ON workforce_invitations
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
