-- =============================================================================
-- Migration 0347 — FORCE RLS + service-role-only policy on tenant_identities
-- (hardening X-1: close a latent cross-tenant PII exposure).
--
-- THE GAP
-- -------
-- tenant_identities (the phone-keyed, cross-org principal registry — one row
-- per real human, carrying phone_normalized, email, and a profile jsonb) was
-- created in 0305 with indexes but NEVER received row-level security. Every
-- other global spine table got it (identity_auth_principals in 0345; the
-- tenant-scoped tables in 0331/0333/0334/0336) — tenant_identities was missed.
-- Migration 0345's own header even ASSUMED this posture existed ("FORCE RLS
-- with a service-role-only policy ... mirrors the tenant_identities posture"),
-- but it was never applied. So a request-scoped session (which runs as the
-- ordinary app role, not BYPASSRLS) could read EVERY human's phone/email/
-- profile across ALL tenants — a cross-tenant PII exposure and a violation of
-- the CLAUDE.md "RLS is FORCE-enabled on every tenant-scoped table" rule.
--
-- THE FIX (identical shape to identity_auth_principals in 0345)
-- ------------------------------------------------------------
-- tenant_identities is a GLOBAL cross-tenant bridge by design — it has no
-- tenant_id column and must NOT be tenant-isolated (that would break the
-- cross-org identity lookup). The correct posture is therefore the same as
-- identity_auth_principals: FORCE RLS + a service-role-ONLY policy, so the
-- repositories that legitimately read it (always under withServiceRoleContext)
-- keep working, while any request-scoped session is denied. Defence in depth:
-- the explicit key-scoped WHERE in those repos is the primary gate; this makes
-- RLS the backstop so a future un-scoped read cannot leak the whole registry.
--
-- IDEMPOTENCY / FRESH-DB SAFETY: ENABLE/FORCE are idempotent; the policy is
-- created in a guarded DO-block (CREATE POLICY has no IF NOT EXISTS); the anon
-- REVOKE is role-guarded. Pure no-op on a DB that already has it.
--
-- TENANT SCOPE: this ADDS isolation; it removes nothing. No money/licence/
-- ledger records live here. Immutable once shipped — append, never edit.
--
-- Companion: packages/database/src/migrations/down/0347_down_rls_tenant_identities_closure.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tenant_identities') IS NULL THEN
    RAISE NOTICE 'tenant_identities absent — skipping RLS closure (fresh-DB ordering)';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.tenant_identities ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.tenant_identities FORCE  ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'tenant_identities'
       AND policyname = 'tenant_identities_service_role_bypass'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY tenant_identities_service_role_bypass
        ON public.tenant_identities FOR ALL
        USING      (current_setting('app.is_service_role', true) = 'true')
        WITH CHECK (current_setting('app.is_service_role', true) = 'true');
    $pol$;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.tenant_identities FROM anon';
  END IF;
END $$;

COMMENT ON TABLE tenant_identities IS
  'Phone-keyed cross-org principal registry (one row per human). GLOBAL spine '
  '— no tenant_id by design; FORCE RLS + service-role-only access (0347). '
  'Repositories read it under withServiceRoleContext; request-scoped sessions '
  'are denied.';

COMMIT;
