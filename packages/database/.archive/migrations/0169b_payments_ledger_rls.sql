-- =============================================================================
-- 0169: payments-ledger RLS + tenant-scoped unique index
--
-- Closes 1 CRITICAL + 1 HIGH from the payments-ledger sweep paired with
-- the application-layer fixes in `services/payments-ledger/src/
-- repositories/drizzle-payment-intent.repository.ts` (findByExternalId
-- tenant predicate) and the loud-503 fail-fast in `factory.ts`.
--
-- Two independent changes, both idempotent + safe to re-run:
--
--   1. ENABLE + FORCE RLS on `accounts`, `ledger_entries`, `statements`
--      using the same loop pattern as 0166b_rls_promote_out_wave.sql.
--      These three are the remaining money-touching tables that landed
--      after the 0166 wave and were never wrapped. RLS on
--      `payment_intents` and `disbursements` was already shipped in 0166.
--
--   2. DROP + RECREATE the unique index on `payment_intents`:
--           BEFORE: UNIQUE (provider_name, external_id)
--           AFTER:  UNIQUE (tenant_id, provider_name, external_id)
--      Closes the cross-tenant predicate gap surfaced in the app-layer
--      review. With the old index, a leaked external_id from tenant A
--      could be used to look up / mutate tenant B's payment row via
--      `findByExternalId(externalId, providerName)`. Widening the unique
--      key to include tenant_id is the DB-level enforcement that
--      complements the new mandatory `tenantId` predicate in the
--      `findByExternalId(externalId, providerName, tenantId)` method.
--
-- Idempotent: every operation gated on table/index existence so this
-- migration is safe to run repeatedly and on a fresh DB.
--
-- Array variable name (`tenant_tables`) matches the
-- `audit-rls-coverage` scanner expectation so the loop-installed
-- policies are picked up by CI.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. ENABLE RLS on accounts / ledger_entries / statements
--    Mirrors the policy pattern from 0166b_rls_promote_out_wave.sql.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'accounts',
    'ledger_entries',
    'statements'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- Enable + force RLS (idempotent).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- Drop pre-existing policies with our canonical names.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- Tenant-scoped SELECT.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Tenant-scoped INSERT/UPDATE/DELETE. accounts + ledger_entries
      -- are append-mostly but statements get status transitions
      -- (DRAFT → FINAL → SENT), so FOR ALL is correct.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access (defence-in-depth).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Widen payment_intents unique index to include tenant_id
--
-- The Drizzle schema declared `payment_intents_external_idx` as
-- UNIQUE(provider_name, external_id). With multi-tenant providers,
-- two tenants may legitimately share an external_id namespace
-- (e.g. two Stripe accounts can both emit `pi_xxx` with overlapping
-- suffixes; M-Pesa CheckoutRequestIDs are sandbox-recyclable). The
-- application-layer findByExternalId() now requires tenantId; the
-- DB-level unique key must match.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='payment_intents'
  ) THEN
    -- Drop the old (provider_name, external_id) unique index if present.
    -- Use IF EXISTS so a fresh DB (where the index was never created
    -- under the legacy name) is a no-op.
    EXECUTE 'DROP INDEX IF EXISTS public.payment_intents_external_idx';

    -- Recreate the unique index scoped to (tenant_id, provider_name,
    -- external_id). CONCURRENTLY would be ideal in prod but is not
    -- allowed inside a transaction block; the migration runner runs
    -- each file in a transaction so we use the regular form and
    -- accept the brief lock on this index slot. Index name is kept
    -- stable so subsequent migrations that DROP IF EXISTS keep working.
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'payment_intents_external_idx'
    ) THEN
      EXECUTE $idx$
        CREATE UNIQUE INDEX payment_intents_external_idx
          ON public.payment_intents (tenant_id, provider_name, external_id)
          WHERE external_id IS NOT NULL AND provider_name IS NOT NULL
      $idx$;
    END IF;
  END IF;
END
$$;

-- Operator note: after this migration the payments-ledger service
-- expects `findByExternalId(externalId, providerName, tenantId)`. The
-- companion app-layer change is in this PR. Webhook routers in
-- `services/payments-ledger/src/server.ts` need a follow-up to
-- resolve tenantId from each provider's verified payload
-- (Stripe metadata.tenant_id, M-Pesa AccountReference, etc.) — they
-- are intentionally out of scope for this PR per the scoping rules
-- and tracked separately.
