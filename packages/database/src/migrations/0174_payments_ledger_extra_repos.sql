-- =============================================================================
-- 0172: Defence-in-depth guard for the second half of the payments-ledger
-- ORM-unification wave.
--
-- W2 L (migration 0167) ported PaymentIntent to Drizzle. This wave (W4-A's
-- successor) ports the remaining four payments-ledger repos to Drizzle:
--
--     - DrizzleAccountRepository
--     - DrizzleLedgerRepository
--     - DrizzleStatementRepository
--     - DrizzleDisbursementRepository
--
-- The four target tables (`accounts`, `ledger_entries`, `statements`,
-- `disbursements`) already exist — they were created by the auto-generated
-- Drizzle migration that mirrors `packages/database/src/schemas/
-- ledger.schema.ts`, and 0167 reconciled the legacy Prisma column names
-- to the Drizzle layout. RLS for all four is already shipped:
--
--     0166b_rls_promote_out_wave.sql   ⇒ payment_intents + disbursements
--     0169b_payments_ledger_rls.sql    ⇒ accounts + ledger_entries + statements
--
-- This migration is therefore a NO-OP on a fresh, Drizzle-managed DB. Its
-- job is purely defence-in-depth:
--
--     1. CREATE TABLE IF NOT EXISTS for the four payments-ledger tables.
--        Catches the edge case where an operator applies migrations
--        out-of-order or where 0167 ran against a half-migrated DB whose
--        Drizzle migration runner crashed before creating the table. Idem-
--        potent and harmless when the tables already exist.
--
--     2. ALTER TABLE … ADD COLUMN IF NOT EXISTS for any column the new
--        Drizzle repos depend on that may not yet exist in a DB that was
--        snapshotted between the legacy Prisma DDL and 0167's reconcile.
--        This is a superset of 0167 §2 — keeping it here means the
--        Drizzle-repo wave can land independently of 0167's success.
--
--     3. Re-assert RLS + tenant-isolation policies on all four tables.
--        If 0169 was rolled back by an operator (unlikely but possible),
--        this migration re-installs the policies so the new repos never
--        execute under an RLS-disabled grant.
--
-- Idempotent: every operation is gated on table/column/policy existence.
-- Safe to run repeatedly, safe on a fresh DB.
--
-- Migration sequence reference:
--     0167 — payments-ledger Drizzle reconcile (column renames)
--     0168 — kill_switch_feature_flags
--     0169 — payments-ledger RLS (accounts/ledger_entries/statements)
--     0170 — kill_switch_expand
--     0171 — hq_tool_flags
--     0172 — THIS migration (Drizzle repo wave guard)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. CREATE TABLE IF NOT EXISTS — defensive guard.
--
-- Pure inserts of the tables the new Drizzle repos depend on. The schema
-- of these tables on a Drizzle-managed DB is set by `ledger.schema.ts`;
-- we re-state only the columns we KNOW the new repos read or write, plus
-- the primary-key + tenant_id NOT NULL invariants. ALTER TABLE … ADD
-- COLUMN below adds anything the table lacked.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accounts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  customer_id text,
  owner_id text,
  property_id text,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  currency text NOT NULL,
  balance_minor_units integer NOT NULL DEFAULT 0,
  last_entry_id text,
  last_entry_at timestamptz,
  entry_count integer NOT NULL DEFAULT 0,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text,
  closed_at timestamptz,
  closed_by text
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  account_id text NOT NULL,
  journal_id text NOT NULL,
  type text NOT NULL,
  direction text NOT NULL,
  amount_minor_units integer NOT NULL,
  currency text NOT NULL,
  balance_after_minor_units integer NOT NULL,
  sequence_number integer NOT NULL,
  effective_date timestamptz NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  payment_intent_id text,
  lease_id text,
  property_id text,
  unit_id text,
  invoice_id text,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE TABLE IF NOT EXISTS public.statements (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  account_id text NOT NULL,
  owner_id text,
  customer_id text,
  property_id text,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  period_type text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  currency text NOT NULL,
  opening_balance_minor_units integer NOT NULL DEFAULT 0,
  closing_balance_minor_units integer NOT NULL DEFAULT 0,
  total_debits_minor_units integer NOT NULL DEFAULT 0,
  total_credits_minor_units integer NOT NULL DEFAULT 0,
  net_change_minor_units integer NOT NULL DEFAULT 0,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  summaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipient_email text,
  sent_at timestamptz,
  viewed_at timestamptz,
  document_url text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE IF NOT EXISTS public.disbursements (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  amount_minor_units integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  destination text NOT NULL,
  destination_type text NOT NULL DEFAULT 'bank_account',
  provider text,
  transfer_id text,
  provider_response jsonb DEFAULT '{}'::jsonb,
  description text,
  initiated_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  estimated_arrival timestamptz,
  failure_reason text,
  failure_code text,
  idempotency_key text,
  ledger_entry_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ALTER TABLE … ADD COLUMN IF NOT EXISTS — bring half-migrated DBs
--    into line with the Drizzle layout the new repos depend on. Pure
--    additive; no DROP / RENAME (those live in 0167).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS public.accounts
  ADD COLUMN IF NOT EXISTS last_entry_id text,
  ADD COLUMN IF NOT EXISTS last_entry_at timestamptz,
  ADD COLUMN IF NOT EXISTS entry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by text;

ALTER TABLE IF EXISTS public.ledger_entries
  ADD COLUMN IF NOT EXISTS journal_id text,
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS sequence_number integer,
  ADD COLUMN IF NOT EXISTS effective_date timestamptz,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_intent_id text,
  ADD COLUMN IF NOT EXISTS lease_id text,
  ADD COLUMN IF NOT EXISTS property_id text,
  ADD COLUMN IF NOT EXISTS unit_id text,
  ADD COLUMN IF NOT EXISTS invoice_id text,
  ADD COLUMN IF NOT EXISTS created_by text;

ALTER TABLE IF EXISTS public.statements
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS property_id text,
  ADD COLUMN IF NOT EXISTS opening_balance_minor_units integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_balance_minor_units integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_debits_minor_units integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_credits_minor_units integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_change_minor_units integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS summaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_url text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

ALTER TABLE IF EXISTS public.disbursements
  ADD COLUMN IF NOT EXISTS destination_type text NOT NULL DEFAULT 'bank_account',
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_response jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS initiated_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_arrival timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS ledger_entry_id text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Indexes that the new Drizzle repos exploit. CREATE INDEX IF NOT
--    EXISTS so a Drizzle-managed DB that already has them is a no-op.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS accounts_tenant_idx ON public.accounts (tenant_id);
CREATE INDEX IF NOT EXISTS accounts_customer_idx ON public.accounts (customer_id);
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON public.accounts (owner_id);
CREATE INDEX IF NOT EXISTS accounts_property_idx ON public.accounts (property_id);
CREATE INDEX IF NOT EXISTS accounts_type_idx ON public.accounts (type);
CREATE INDEX IF NOT EXISTS accounts_status_idx ON public.accounts (status);

CREATE INDEX IF NOT EXISTS ledger_entries_tenant_idx ON public.ledger_entries (tenant_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON public.ledger_entries (account_id);
CREATE INDEX IF NOT EXISTS ledger_entries_journal_idx ON public.ledger_entries (journal_id);
CREATE INDEX IF NOT EXISTS ledger_entries_type_idx ON public.ledger_entries (type);
CREATE INDEX IF NOT EXISTS ledger_entries_effective_date_idx ON public.ledger_entries (effective_date);
CREATE INDEX IF NOT EXISTS ledger_entries_payment_intent_idx ON public.ledger_entries (payment_intent_id);
CREATE INDEX IF NOT EXISTS ledger_entries_lease_idx ON public.ledger_entries (lease_id);
CREATE INDEX IF NOT EXISTS ledger_entries_posted_at_idx ON public.ledger_entries (posted_at);

CREATE INDEX IF NOT EXISTS statements_tenant_idx ON public.statements (tenant_id);
CREATE INDEX IF NOT EXISTS statements_account_idx ON public.statements (account_id);
CREATE INDEX IF NOT EXISTS statements_owner_idx ON public.statements (owner_id);
CREATE INDEX IF NOT EXISTS statements_customer_idx ON public.statements (customer_id);
CREATE INDEX IF NOT EXISTS statements_type_idx ON public.statements (type);
CREATE INDEX IF NOT EXISTS statements_status_idx ON public.statements (status);
CREATE INDEX IF NOT EXISTS statements_period_idx ON public.statements (period_start, period_end);

CREATE INDEX IF NOT EXISTS disbursements_tenant_idx ON public.disbursements (tenant_id);
CREATE INDEX IF NOT EXISTS disbursements_owner_idx ON public.disbursements (owner_id);
CREATE INDEX IF NOT EXISTS disbursements_status_idx ON public.disbursements (status);
CREATE INDEX IF NOT EXISTS disbursements_transfer_idx ON public.disbursements (provider, transfer_id);
CREATE INDEX IF NOT EXISTS disbursements_created_at_idx ON public.disbursements (created_at);

-- Unique indexes — these are the constraints the new Drizzle repos rely
-- on (optimistic-lock idempotency / one-statement-per-period / etc.).
-- Wrapped in DO blocks so the migration tolerates the original Drizzle
-- migration having installed them under the same name (which Postgres
-- treats as a hard error if we re-create with CREATE INDEX).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='ledger_entries_account_sequence_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX ledger_entries_account_sequence_idx ON public.ledger_entries (account_id, sequence_number)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='statements_account_period_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX statements_account_period_idx ON public.statements (tenant_id, account_id, type, period_start, period_end)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='disbursements_idempotency_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX disbursements_idempotency_idx ON public.disbursements (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='accounts_customer_type_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX accounts_customer_type_idx ON public.accounts (tenant_id, customer_id, type) WHERE customer_id IS NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='accounts_owner_type_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX accounts_owner_type_idx ON public.accounts (tenant_id, owner_id, type) WHERE owner_id IS NOT NULL';
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Re-assert RLS + tenant-isolation policies. Mirrors 0166 + 0169
--    so this migration is self-contained: the new Drizzle repos refuse
--    to run under any state where RLS isn't enforced.
--
-- Array variable name (`tenant_tables`) matches the
-- `audit-rls-coverage` scanner expectation so CI picks up the policies.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'accounts',
    'ledger_entries',
    'statements',
    'disbursements'
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

      -- Drop pre-existing policies with our canonical names so the
      -- CREATE POLICY below is idempotent.
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

      -- Tenant-scoped INSERT/UPDATE/DELETE.
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

-- Operator note: after this migration the payments-ledger service runs
-- five Drizzle-backed repositories under DATABASE_URL. The InMemory
-- adapters remain for tests + local dev WITHOUT DATABASE_URL. There is
-- no production-correctness regression for un-ported repos because all
-- five are now ported.
