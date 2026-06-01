-- =============================================================================
-- Migration 0165 — disbursements: cross-tenant-safe transfer-id resolution
--
-- WHY THIS MIGRATION EXISTS (F1 — CROSS-TENANT money write)
-- --------------------------------------------------------
-- The M-Pesa B2C result webhook runs OUTSIDE tenant context (webhooks are
-- excluded from auth). It resolves the disbursement a result belongs to by the
-- provider's ConversationID == our `transfer_id`. The pre-existing index on
-- `disbursements (provider, transfer_id)` was NOT unique and NOT tenant-scoped,
-- so tenant A's inbound B2C result could resolve to tenant B's disbursement
-- and post a compensating reversal into tenant B's ledger — a cross-tenant
-- money write. (Under FORCE RLS with an empty GUC the same lookup instead
-- returned zero rows and the B2C never finalised — money debited, undelivered,
-- unreversed.)
--
-- THE FIX
-- -------
--   1. A UNIQUE index on (tenant_id, provider, transfer_id) so a transfer id
--      resolves to AT MOST one row per tenant and never to another tenant's
--      disbursement. The repository's `findByTransferId` now REQUIRES the
--      tenant id and is GUC-bound; this index is the DB-level guarantee.
--   2. A `service_role_bypass` policy so the webhook can discover a
--      disbursement's owning tenant from its globally-unique primary key
--      (`resolveTenantById`, the `disb-<id>` originator) BEFORE it knows the
--      tenant — then bind that tenant for every subsequent op. The bypass is
--      gated on `app.is_service_role = 'true'`, set transaction-locally only
--      for that single PK read.
--
-- The table itself is created IF NOT EXISTS so this migration is self-contained
-- on a fresh install (the disbursements table is not in any other live
-- migration — its canonical schema was archived in 0167b/0174 when the database
-- package pivoted to the mining domain; the payments-ledger service retains a
-- byte-for-byte Drizzle declaration in
-- services/payments-ledger/src/repositories/drizzle-disbursement.repository.ts).
--
-- HARD RULES HONOURED
-- -------------------
--   * Money columns are BIGINT minor units (integer minor units, BIGINT
--     storage so an accumulating value cannot overflow INTEGER) — matches the
--     live 0160 money tables + the service's Drizzle declaration.
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + tenant_isolation policy
--     on current_setting('app.current_tenant_id', true) (the CORRECT GUC the
--     repos bind; never the legacy app.tenant_id). REVOKE anon, guarded for
--     vanilla PG (pg_roles).
--   * service_role_bypass mirrors the archived 0179b shape exactly.
--
-- IDEMPOTENT / FORWARD-ONLY: CREATE TABLE / CREATE INDEX IF NOT EXISTS, DO-block
-- existence guards on policies + the index swap, pg_roles anon guard. Safe to
-- re-run. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — disbursements table (defensive create; byte-for-byte the service's
-- Drizzle declaration). amount_minor_units is BIGINT (integer minor units,
-- BIGINT storage). No-op on a DB that already has the table.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.disbursements (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL,
  owner_id            text NOT NULL,
  amount_minor_units  bigint NOT NULL,
  currency            text NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING',
  destination         text NOT NULL,
  destination_type    text NOT NULL DEFAULT 'bank_account',
  provider            text,
  transfer_id         text,
  provider_response   jsonb DEFAULT '{}'::jsonb,
  description         text,
  initiated_at        timestamptz,
  completed_at        timestamptz,
  failed_at           timestamptz,
  estimated_arrival   timestamptz,
  failure_reason      text,
  failure_code        text,
  idempotency_key     text,
  ledger_entry_id     text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);

-- Bring a half-migrated table up to the bigint money column without data loss.
-- (No-op when the column is already bigint; widens integer -> bigint safely.)
ALTER TABLE IF EXISTS public.disbursements
  ALTER COLUMN amount_minor_units TYPE bigint;

-- Supporting (non-unique) lookup indexes — match the archived 0174 set so a
-- Drizzle-managed DB that already has them is a no-op.
CREATE INDEX IF NOT EXISTS disbursements_tenant_idx     ON public.disbursements (tenant_id);
CREATE INDEX IF NOT EXISTS disbursements_owner_idx      ON public.disbursements (owner_id);
CREATE INDEX IF NOT EXISTS disbursements_status_idx     ON public.disbursements (status);
CREATE INDEX IF NOT EXISTS disbursements_created_at_idx ON public.disbursements (created_at);

-- Idempotency uniqueness the service relies on (one disbursement per
-- tenant+idempotency_key). Partial (key may be null) — wrapped so a pre-
-- existing index under the same name is tolerated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'disbursements_idempotency_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX disbursements_idempotency_idx '
         || 'ON public.disbursements (tenant_id, idempotency_key) '
         || 'WHERE idempotency_key IS NOT NULL';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §2 — the F1 fix: replace the cross-tenant-unsafe (provider, transfer_id)
-- index with a UNIQUE (tenant_id, provider, transfer_id) index.
--
-- The old index let a transfer id match across tenants. The new UNIQUE index
-- scopes a transfer id to a single tenant AND enforces at-most-one row per
-- (tenant, provider, transfer_id). Partial: only rows that actually carry a
-- provider + transfer id (a PENDING disbursement has neither yet, and multiple
-- NULLs must not collide).
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.disbursements_transfer_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'disbursements_tenant_provider_transfer_uidx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX disbursements_tenant_provider_transfer_uidx '
         || 'ON public.disbursements (tenant_id, provider, transfer_id) '
         || 'WHERE provider IS NOT NULL AND transfer_id IS NOT NULL';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — FORCE RLS + tenant-isolation policy + service_role_bypass.
--
-- tenant_isolation mirrors live 0160/0163: equality against
-- current_setting('app.current_tenant_id', true). service_role_bypass mirrors
-- the archived 0179b: a row is visible/mutable when
-- current_setting('app.is_service_role', true) = 'true'. The webhook sets that
-- GUC transaction-locally ONLY for the single globally-unique PK read that
-- resolves a disbursement's owning tenant; every other op runs under the
-- per-tenant policy. Idempotent: ENABLE/FORCE are no-ops if already set;
-- policies guarded by pg_policies existence checks.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'disbursements'
  ) THEN
    EXECUTE 'ALTER TABLE public.disbursements ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.disbursements FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'disbursements'
        AND policyname = 'disbursements_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY disbursements_tenant_isolation ON public.disbursements
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- F1 — cross-tenant tenant-resolution read (resolveTenantById). Gated on
    -- the service-role GUC, set transaction-locally only for that single PK
    -- read. Mirrors the archived 0179b service_role_bypass shape.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'disbursements'
        AND policyname = 'service_role_bypass'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY service_role_bypass ON public.disbursements
        FOR ALL
        USING (current_setting('app.is_service_role', true) = 'true')
        WITH CHECK (current_setting('app.is_service_role', true) = 'true');
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.disbursements FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.disbursements IS
  'Owner payouts (money path via LedgerService.post()). amount_minor_units is '
  'BIGINT minor units (integer minor units, BIGINT storage). UNIQUE '
  '(tenant_id, provider, transfer_id) scopes a provider transfer id to one '
  'tenant so an out-of-context B2C result can never resolve cross-tenant (F1). '
  'RLS FORCE on app.current_tenant_id + service_role_bypass for the PK-keyed '
  'tenant-resolution read. Added in 0165.';

COMMIT;
