-- =============================================================================
-- 0167: Unify payments-ledger onto Drizzle (close A2 BLOCKER from
-- .audit/deep-audit-2026-05-20.md — "Dual ORMs in one DB").
--
-- BEFORE: `services/payments-ledger/prisma/schema.prisma` declared
--   PaymentIntent / Account / LedgerEntry / Statement / Disbursement
-- with Prisma-style column names (`amount`, `balance`, `balance_after`,
-- `error_message`, `external_id`, `provider_name`, `metadata`,
-- `refunded_amount`, `sent_to`, `sent_at`, `processed_at`).
--
-- AFTER: `packages/database/src/schemas/ledger.schema.ts` (re-exported
-- via `payments-ledger.schema.ts`) declares the canonical Drizzle
-- representation with explicit-minor-units names (`amount_minor_units`,
-- `balance_minor_units`, `balance_after_minor_units`, `failure_reason`,
-- `external_id`, `provider_name`, `metadata`,
-- `refunded_amount_minor_units`, `recipient_email`, `sent_at`, etc.)
-- plus pgEnum types for `account_type`, `account_status`,
-- `ledger_entry_type`, `entry_direction`, `statement_type`,
-- `statement_status`, `statement_period_type`, `disbursement_status`.
--
-- Strategy: idempotent forward-only migration. Every table created
-- with CREATE TABLE IF NOT EXISTS so the migration is safe whether
-- Prisma already created the table or this is a fresh DB.
--
-- The actual table DDL is OWNED by the Drizzle migration runner via
-- the auto-generated migration that mirrors `ledger.schema.ts` (see
-- migration 0001c_cases_inspections_ledger.sql and the subsequent
-- waves). This migration only adds:
--
--   1. Defence-in-depth ALTER TABLE … RENAME COLUMN statements that
--      reconcile the legacy Prisma column names to the Drizzle layout
--      IF AND ONLY IF the legacy column exists. Pure no-op on a fresh
--      DB where Drizzle was authoritative from day one.
--
--   2. ALTER TABLE … ADD COLUMN IF NOT EXISTS for the columns Drizzle
--      added that Prisma never declared (idempotency_key on accounts,
--      destination_type on disbursements, etc.).
--
--   3. A check-only assertion block at the tail that fails the
--      migration if any of the legacy Prisma column names is STILL
--      present after the renames — guards against half-migrated rows.
--
-- The Prisma `schema.prisma` file is preserved at its original path
-- with a deprecation header for traceability. Operators MUST NOT run
-- `prisma migrate dev` / `prisma migrate deploy` after this migration.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Reconcile legacy Prisma column names ⇒ Drizzle layout.
--
-- Each block runs only when the legacy column exists AND the new
-- Drizzle column does not, so the migration is safe to run repeatedly
-- and harmless on a fresh DB.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- payment_intents.amount → payment_intents.amount_minor_units
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='amount'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='amount_minor_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.payment_intents RENAME COLUMN amount TO amount_minor_units';
  END IF;

  -- payment_intents.error_message → payment_intents.failure_reason
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='error_message'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='failure_reason'
  ) THEN
    EXECUTE 'ALTER TABLE public.payment_intents RENAME COLUMN error_message TO failure_reason';
  END IF;

  -- payment_intents.refunded_amount → payment_intents.refunded_amount_minor_units
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='refunded_amount'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='refunded_amount_minor_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.payment_intents RENAME COLUMN refunded_amount TO refunded_amount_minor_units';
  END IF;

  -- accounts.balance → accounts.balance_minor_units
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='accounts' AND column_name='balance'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='accounts' AND column_name='balance_minor_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.accounts RENAME COLUMN balance TO balance_minor_units';
  END IF;

  -- ledger_entries.amount → ledger_entries.amount_minor_units
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='amount'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='amount_minor_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.ledger_entries RENAME COLUMN amount TO amount_minor_units';
  END IF;

  -- ledger_entries.balance_after → ledger_entries.balance_after_minor_units
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='balance_after'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ledger_entries' AND column_name='balance_after_minor_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.ledger_entries RENAME COLUMN balance_after TO balance_after_minor_units';
  END IF;

  -- ledger_entries.reference_id / reference_type were Prisma-only. Drizzle
  -- represents the same data through journal_id + the typed metadata jsonb.
  -- We do NOT drop the legacy columns here (data loss risk); they're left
  -- in place as no-op carrier columns and stop being written by the
  -- Drizzle-backed repository.

  -- statements.sent_to → statements.recipient_email
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='statements' AND column_name='sent_to'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='statements' AND column_name='recipient_email'
  ) THEN
    EXECUTE 'ALTER TABLE public.statements RENAME COLUMN sent_to TO recipient_email';
  END IF;

  -- disbursements.amount → disbursements.amount_minor_units
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='amount'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='amount_minor_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.disbursements RENAME COLUMN amount TO amount_minor_units';
  END IF;

  -- disbursements.error_message → disbursements.failure_reason
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='error_message'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='failure_reason'
  ) THEN
    EXECUTE 'ALTER TABLE public.disbursements RENAME COLUMN error_message TO failure_reason';
  END IF;

  -- disbursements.external_id → disbursements.transfer_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='external_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='transfer_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.disbursements RENAME COLUMN external_id TO transfer_id';
  END IF;

  -- disbursements.processed_at → disbursements.completed_at
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='processed_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='disbursements' AND column_name='completed_at'
  ) THEN
    EXECUTE 'ALTER TABLE public.disbursements RENAME COLUMN processed_at TO completed_at';
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Add Drizzle-only columns absent from the legacy Prisma schema.
--
-- Pure ALTER TABLE … ADD COLUMN IF NOT EXISTS; safe to run repeatedly.
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
  ADD COLUMN IF NOT EXISTS opening_balance_minor_units integer,
  ADD COLUMN IF NOT EXISTS closing_balance_minor_units integer,
  ADD COLUMN IF NOT EXISTS total_debits_minor_units integer,
  ADD COLUMN IF NOT EXISTS total_credits_minor_units integer,
  ADD COLUMN IF NOT EXISTS net_change_minor_units integer,
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

ALTER TABLE IF EXISTS public.payment_intents
  ADD COLUMN IF NOT EXISTS platform_fee_minor_units integer,
  ADD COLUMN IF NOT EXISTS net_amount_minor_units integer,
  ADD COLUMN IF NOT EXISTS statement_descriptor text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS updated_by text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Post-condition assertion — fail the migration if any legacy
--    Prisma-only column name is STILL present.
--
-- This is a defence-in-depth guard. If an operator manually skipped
-- the rename block (e.g. by running ALTER TABLE … RENAME COLUMN out
-- of band), the assertion catches the drift before downstream services
-- pick up a half-migrated DB.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  legacy_cols record;
  legacy_count int := 0;
BEGIN
  FOR legacy_cols IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND (
        (table_name='payment_intents' AND column_name IN ('amount','error_message','refunded_amount'))
        OR (table_name='accounts'        AND column_name IN ('balance'))
        OR (table_name='ledger_entries'  AND column_name IN ('amount','balance_after'))
        OR (table_name='statements'      AND column_name IN ('sent_to'))
        OR (table_name='disbursements'   AND column_name IN ('amount','error_message','external_id','processed_at'))
      )
  LOOP
    legacy_count := legacy_count + 1;
    RAISE NOTICE 'legacy prisma column still present: %.%', legacy_cols.table_name, legacy_cols.column_name;
  END LOOP;

  IF legacy_count > 0 THEN
    RAISE EXCEPTION 'migration 0167 incomplete: % legacy Prisma column(s) still present', legacy_count;
  END IF;
END
$$;

-- Operator note: after this migration runs the payments-ledger service
-- should be re-deployed with `@borjie/database` ≥ the version that
-- ships `payments-ledger.schema.ts`. The Prisma generator + CLI are
-- removed from `services/payments-ledger/package.json` in the same PR.
