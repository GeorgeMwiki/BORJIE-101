-- =============================================================================
-- Migration 0345 — the CORRECTED buyer model + the pairing state machine
-- (surface-completion SC-3; the edge-case ruling on the SC-1 substrate).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner's load-bearing correction: BUYER ≠ TENANT. A buyer is an EXTERNAL
-- counterparty — a buyer_connection must NEVER grant tenant-insider access
-- into the seller org. The SC-1 shape (0344) conflated the two: EVERY
-- org_memberships row, buyer rows included, carried a NOT-NULL shadow
-- user_id — a `users` row INSIDE the seller's tenant, i.e. exactly the
-- insider bridge a buyer must never hold. This migration makes the
-- separation STRUCTURAL rather than conventional:
--
--   * user_id becomes NULLABLE, and a CHECK constraint pins the invariant
--     both ways: buyer_connection rows MUST have user_id IS NULL (no shadow
--     insider, ever); employment|contractor|guest rows MUST have a shadow
--     user WHEN ACTIVE (they ARE tenant insiders and authz resolves through
--     users+RLS). Non-ACTIVE employment rows (a PENDING public-discovery
--     request, a REJECTED one) may carry NULL — an unapproved stranger must
--     NOT be provisioned an insider users row; the shadow user is created at
--     APPROVE time. The insider boundary now lives in the one column that
--     actually grants insider-ness — it cannot drift back by convention.
--
--   * org_membership_status gains the pairing states. Two pairing modes are
--     law: (a) org-initiated invite/QR (redeem → ACTIVE immediately — the
--     org pre-authorized by issuing the code); (b) PUBLIC DISCOVERY — the
--     org opts in as discoverable, a worker/buyer REQUESTS pairing
--     (→ PENDING), the org APPROVES (→ ACTIVE) or REJECTS (→ REJECTED).
--     REVOKED records an org-initiated end of an ACTIVE membership
--     (distinct from LEFT = member-initiated). Re-request: REJECTED|REVOKED
--     → PENDING again. BLOCKED stays terminal until the org unblocks.
--     NOTE: the new enum values are intentionally NOT referenced anywhere in
--     THIS file — Postgres forbids using an enum value added in the same
--     transaction. 0346 builds the PENDING approval-queue index.
--
--   * invite_codes gains relationship_type — the TRUST-DIRECTION FIX. The
--     SC-1 redeem path took the relationship from the REDEEMER's input, so a
--     caller could claim 'employment' against a buyer invite and obtain a
--     shadow insider user. The INVITE (org-authored) now declares what
--     relationship it grants; the redeem path derives from the invite row.
--
--   * organizations gains `discoverable` (default false) — the explicit
--     opt-in gate for pairing mode (b). Request-pairing routes refuse
--     non-discoverable orgs.
--
--   * identity_auth_principals — the sub↔identity bridge. tenant_identities
--     is keyed on phone (one row per human), but one human can hold several
--     Supabase auth principals (phone-OTP sub on mobile, email sub on web).
--     This table maps each Supabase user id to its tenant_identity so any
--     authenticated principal resolves to the SAME membership graph — the
--     piece that makes the person_links→org_memberships unify (0346)
--     lossless. Global table (no tenant key — it IS the cross-tenant spine,
--     like tenant_identities): FORCE RLS with a service-role-only policy, so
--     request-scoped sessions can never read it directly.
--
-- Approval metadata (requested_note / decided_by / decided_at /
-- decision_note) is additive on org_memberships. decided_by is a SOFT
-- reference to users.id (no FK): the audit value must survive the decider
-- user's deletion.
--
-- TENANT SCOPE (CLAUDE.md hard rule): org_memberships / invite_codes /
-- organizations policies are UNCHANGED (0336). identity_auth_principals gets
-- FORCE RLS + service_role_bypass only (mirrors the tenant_identities
-- posture, strictly hardened).
--
-- FRESH-DB SAFETY / IDEMPOTENCY: every step is guarded (ADD VALUE IF NOT
-- EXISTS / ADD COLUMN IF NOT EXISTS / DO-block constraint guard / CREATE
-- TABLE IF NOT EXISTS). On a fully-migrated DB this file is a pure no-op.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/migrations/0346_membership_unify_backfill.sql
--   * packages/database/src/migrations/down/0345_down_corrected_buyer_model_pairing_states.sql
--   * packages/database/src/repositories/org-membership.repository.ts
-- =============================================================================

BEGIN;

-- Belt-and-braces for the decouple UPDATE below: org_memberships is
-- FORCE-RLS'd (0336); the service-role GUC makes the statement valid under
-- any runner role (CI superuser, Supabase bypassrls, or a plain role).
SELECT set_config('app.is_service_role', 'true', false);

-- ─── §1 — pairing states ────────────────────────────────────────────────────
-- PG12+ allows ADD VALUE inside a transaction as long as the new value is not
-- USED in the same transaction — nothing below references these values.
ALTER TYPE org_membership_status ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE org_membership_status ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE org_membership_status ADD VALUE IF NOT EXISTS 'REVOKED';

-- ─── §2 — approval metadata (additive) ──────────────────────────────────────
ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS requested_note text;
ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE org_memberships
  ADD COLUMN IF NOT EXISTS decision_note text;

COMMENT ON COLUMN org_memberships.requested_note IS
  'Free-text note from the requester on a public-discovery pairing request '
  '(mode b). NULL for invite/QR joins.';
COMMENT ON COLUMN org_memberships.decided_by IS
  'users.id of the org-side decider for approve/reject/revoke. SOFT '
  'reference (no FK) so the audit value survives user deletion.';

-- ─── §3 — buyer ≠ tenant-insider, made structural ───────────────────────────
ALTER TABLE org_memberships ALTER COLUMN user_id DROP NOT NULL;

-- Decouple any pre-existing buyer rows from their shadow insider user.
-- (The write-path shipped days ago with zero routes, so this is expected to
-- touch 0 rows everywhere — defensive only.)
UPDATE org_memberships
   SET user_id = NULL
 WHERE relationship_type = 'buyer_connection'
   AND user_id IS NOT NULL;

-- The two-way invariant: buyers NEVER hold a shadow insider user; every
-- ACTIVE employment-class membership ALWAYS does. Non-ACTIVE employment
-- rows may carry NULL — a PENDING request must not provision an insider
-- users row before the org approves (the shadow user is created at APPROVE
-- time). 'ACTIVE' is a pre-0345 enum value, so referencing it here is safe
-- in the same transaction as the ADD VALUEs above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'org_memberships_buyer_no_shadow_user'
       AND conrelid = 'public.org_memberships'::regclass
  ) THEN
    ALTER TABLE org_memberships
      ADD CONSTRAINT org_memberships_buyer_no_shadow_user CHECK (
        (relationship_type = 'buyer_connection' AND user_id IS NULL)
        OR (
          relationship_type <> 'buyer_connection'
          AND (status <> 'ACTIVE' OR user_id IS NOT NULL)
        )
      );
  END IF;
END $$;

-- ─── §4 — the invite declares the relationship it grants ────────────────────
ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS relationship_type org_membership_relationship_type
    NOT NULL DEFAULT 'employment';

COMMENT ON COLUMN invite_codes.relationship_type IS
  'The relationship this invite grants (org-authored). The redeem path '
  'derives the membership relationship from THIS column — never from the '
  'redeemer''s input (trust-direction fix: a caller must not be able to '
  'claim employment against a buyer invite and obtain a shadow insider).';

-- ─── §5 — public-discovery opt-in ───────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS organizations_discoverable_idx
  ON organizations (tenant_id)
  WHERE discoverable;

COMMENT ON COLUMN organizations.discoverable IS
  'Pairing mode (b) opt-in: when true the org appears in the public pairing '
  'directory and accepts membership requests (worker/buyer → PENDING → org '
  'approves/rejects). Default false — orgs are invisible unless they opt in.';

-- ─── §6 — identities may be keyed on phone OR email ─────────────────────────
-- tenant_identities was phone-keyed NOT NULL (mobile phone-OTP actors), but
-- owner-web principals authenticate by EMAIL and may carry no phone at all.
-- Provisioning must be total across every surface: phone stays the primary
-- key signal where present (the existing unique index allows multiple
-- NULLs); email becomes a fallback identity key (unique only among
-- phone-less identities); at least one of the two must exist.
ALTER TABLE tenant_identities ALTER COLUMN phone_normalized DROP NOT NULL;
-- The country code annotates the phone normalization — no phone, no code.
ALTER TABLE tenant_identities ALTER COLUMN phone_country_code DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenant_identities_phone_or_email'
       AND conrelid = 'public.tenant_identities'::regclass
  ) THEN
    ALTER TABLE tenant_identities
      ADD CONSTRAINT tenant_identities_phone_or_email CHECK (
        phone_normalized IS NOT NULL OR email IS NOT NULL
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_identities_email_key_idx
  ON tenant_identities (lower(email))
  WHERE phone_normalized IS NULL;

-- ─── §7 — identity_auth_principals (sub ↔ identity bridge) ──────────────────
CREATE TABLE IF NOT EXISTS identity_auth_principals (
  id                 text PRIMARY KEY,
  tenant_identity_id text NOT NULL
    REFERENCES tenant_identities(id) ON DELETE CASCADE,
  supabase_user_id   uuid NOT NULL,
  -- phone-otp | email | sso | person-links-backfill
  auth_method        text NOT NULL DEFAULT 'phone-otp',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_auth_principals_sub_idx
  ON identity_auth_principals (supabase_user_id);
CREATE INDEX IF NOT EXISTS identity_auth_principals_identity_idx
  ON identity_auth_principals (tenant_identity_id);

-- Global cross-tenant spine table: request-scoped sessions must never read it
-- directly. FORCE RLS + a service-role-only policy (no tenant_isolation
-- policy is possible — there is no tenant key by design).
ALTER TABLE identity_auth_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_auth_principals FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'identity_auth_principals'
       AND policyname = 'identity_auth_principals_service_role_bypass'
  ) THEN
    CREATE POLICY identity_auth_principals_service_role_bypass
      ON public.identity_auth_principals FOR ALL
      USING      (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.identity_auth_principals FROM anon;
  END IF;
END $$;

COMMENT ON TABLE identity_auth_principals IS
  'Supabase-sub ↔ tenant_identity bridge. One human (tenant_identities, '
  'keyed on phone) may hold several auth principals (phone-OTP sub on '
  'mobile, email sub on web); every principal resolves to the SAME '
  'membership graph. Service-role access only.';

COMMIT;
