-- =============================================================================
-- Migration 0160 — Restore the double-entry payments-ledger tables into the
--                   LIVE in-tree migration set (accounts, ledger_entries,
--                   payment_intents) + durability columns + FORCE RLS.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The money-path tables that back `LedgerService.post()` (the CLAUDE.md hard
-- rule: "Money path goes through LedgerService.post()") existed ONLY in the
-- ARCHIVED BossNyumba lineage —
--   packages/database/.archive/migrations/0001c_cases_inspections_ledger.sql
--     (accounts + ledger_entries canonical DDL + enums),
--   packages/database/.archive/migrations/0167b_payments_ledger_drizzle.sql
--     (Prisma->Drizzle column reconcile),
--   packages/database/.archive/migrations/0174_payments_ledger_extra_repos.sql
--     (defensive CREATE TABLE IF NOT EXISTS for the four Drizzle repos),
--   packages/database/.archive/migrations/0169b_payments_ledger_rls.sql
--     (RLS on accounts/ledger_entries/statements)
-- — and in the payments-ledger service's OWN local Drizzle declarations
-- (services/payments-ledger/src/repositories/drizzle-schema.ts). They were
-- NEVER present in packages/database/src/migrations/, so a fresh in-tree
-- migrate leaves the ledger spine absent and every money write fails.
--
-- This migration restores them into the live set. Canonical column layout is
-- taken from the archived 0001c DDL + the service's drizzle-schema.ts (column
-- names are parity-mandatory: *_minor_units, sequence_number,
-- balance_after_minor_units, idempotency_key, failure_reason, ...).
--
-- DURABILITY COLUMNS (a sibling ledger agent depends on these)
-- ------------------------------------------------------------
-- ledger_entries gains two NEW append-only durability columns that the
-- archived schema never carried, so the hash-chained entry sibling can land:
--   * prev_hash        TEXT  -- previous entry's this_hash (NULL for genesis)
--   * this_hash        TEXT  -- this entry's chain hash
-- They are nullable so the migration is safe on a table that already holds
-- pre-durability rows; the sibling backfills + starts writing them.
-- Post-once replay safety is the SEPARATE journal_idempotency table (0162),
-- a per-JOURNAL grain — so ledger_entries carries NO idempotency_key (a
-- per-entry UNIQUE would wrongly reject the 2nd..Nth line of one journal).
--
-- A "journal" is NOT a separate table: balanced entries that post together
-- share a `journal_id` correlation value on ledger_entries (already present).
-- The "journal/payment_intents" leg of the spine is therefore the
-- payment_intents table (restored below) + the existing journal_id linkage.
--
-- HARD RULES HONOURED
-- -------------------
--   * Money is INTEGER minor units only (no float / numeric); the STORAGE type
--     is BIGINT. TZS is 0-decimal so a minor unit == one whole shilling, but a
--     single realistic gold/tanzanite settlement (and the shared clearing /
--     payable balances that ACCUMULATE with volume) exceed INTEGER's 2.147e9
--     ceiling and throw Postgres 22003 numeric_value_out_of_range. BIGINT
--     (9.22e18) removes the overflow; settlements were already moved to BIGINT
--     in 0161, so the ledger tables they feed must match. balance_minor_units /
--     amount_minor_units / balance_after_minor_units are all BIGINT.
--   * FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) — mirrors 0157's
--     CORRECT GUC (the gateway's databaseMiddleware only ever binds
--     app.current_tenant_id; the legacy app.tenant_id GUC silently zeroes
--     every RLS read/write). We do NOT use the public.current_app_tenant_id()
--     helper from the archived 0169b/0174 because that function is not part
--     of the in-tree migration set.
--   * Append-only spirit: ledger_entries policy is still FOR ALL (the service
--     inserts; corrections are compensating entries, not UPDATEs) but RLS is
--     FORCEd so no app-code path can cross tenants.
--
-- IDEMPOTENT / FORWARD-ONLY: every object guarded with IF NOT EXISTS / DO-block
-- duplicate_object swallow / pg_policies existence check. Safe to re-run and
-- safe whether the table pre-exists (archived lineage already deployed) or
-- this is a fresh DB. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §0 — Enum types (idempotent). Canonical set from archived 0001c +
--      0167b header. Created as the strong-typed backing for the money
--      tables. Each wrapped so a re-run (or a DB that already has the type
--      from the archived lineage) is a no-op.
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM (
    'CUSTOMER_LIABILITY', 'CUSTOMER_DEPOSIT', 'OWNER_OPERATING',
    'OWNER_RESERVE', 'PLATFORM_REVENUE', 'PLATFORM_HOLDING',
    'TRUST_ACCOUNT', 'EXPENSE', 'ASSET'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'RENT_CHARGE', 'RENT_PAYMENT', 'DEPOSIT_CHARGE', 'DEPOSIT_PAYMENT',
    'DEPOSIT_REFUND', 'LATE_FEE', 'MAINTENANCE_CHARGE', 'UTILITY_CHARGE',
    'OWNER_CONTRIBUTION', 'OWNER_DISBURSEMENT', 'PLATFORM_FEE',
    'PAYMENT_PROCESSING_FEE', 'REFUND', 'ADJUSTMENT', 'WRITE_OFF',
    'TRANSFER_IN', 'TRANSFER_OUT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_intent_type AS ENUM (
    'RENT', 'DEPOSIT', 'LATE_FEE', 'MAINTENANCE', 'UTILITY',
    'OTHER', 'REFUND'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_intent_status AS ENUM (
    'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED',
    'REFUNDED', 'PARTIALLY_REFUNDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- §1 — accounts
--
-- The double-entry account register. `balance_minor_units` is BIGINT minor
-- units (CLAUDE.md money rule: integer minor units; BIGINT storage so an
-- accumulating clearing/payable balance cannot overflow INTEGER). NB: the
-- canonical archived schema typed
-- `type`/`status` as enums; here we restore them as TEXT to stay tolerant of
-- DBs whose enum was dropped during the mining pivot, while the §0 enums above
-- remain available for fresh installs / future tightening. The Drizzle schema
-- (accounts.schema-equivalent in payments-ledger.schema.ts) speaks text.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  customer_id          TEXT,
  owner_id             TEXT,
  property_id          TEXT,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  currency             TEXT NOT NULL,
  balance_minor_units  BIGINT NOT NULL DEFAULT 0,
  last_entry_id        TEXT,
  last_entry_at        TIMESTAMPTZ,
  entry_count          INTEGER NOT NULL DEFAULT 0,
  description          TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT,
  updated_by           TEXT,
  closed_at            TIMESTAMPTZ,
  closed_by            TEXT
);

-- Defensive: bring a pre-existing (archived-lineage) table up to the full
-- column set the repos read/write. Pure additive, IF NOT EXISTS.
ALTER TABLE IF EXISTS accounts
  ADD COLUMN IF NOT EXISTS last_entry_id        TEXT,
  ADD COLUMN IF NOT EXISTS last_entry_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_count          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description          TEXT,
  ADD COLUMN IF NOT EXISTS metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by           TEXT,
  ADD COLUMN IF NOT EXISTS updated_by           TEXT,
  ADD COLUMN IF NOT EXISTS closed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by            TEXT;

CREATE INDEX IF NOT EXISTS accounts_tenant_idx   ON accounts(tenant_id);
CREATE INDEX IF NOT EXISTS accounts_customer_idx ON accounts(customer_id);
CREATE INDEX IF NOT EXISTS accounts_owner_idx    ON accounts(owner_id);
CREATE INDEX IF NOT EXISTS accounts_property_idx ON accounts(property_id);
CREATE INDEX IF NOT EXISTS accounts_type_idx     ON accounts(type);
CREATE INDEX IF NOT EXISTS accounts_status_idx   ON accounts(status);

-- One operating/liability/etc. account per (tenant, customer, type) and per
-- (tenant, owner, type). Partial so NULL customer/owner rows don't collide.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'accounts_customer_type_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX accounts_customer_type_idx '
         || 'ON accounts (tenant_id, customer_id, type) '
         || 'WHERE customer_id IS NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'accounts_owner_type_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX accounts_owner_type_idx '
         || 'ON accounts (tenant_id, owner_id, type) '
         || 'WHERE owner_id IS NOT NULL';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §2 — ledger_entries (+ durability columns)
--
-- Append-only double-entry lines. amount/balance_after are BIGINT minor
-- units (integer minor units, BIGINT storage). (account_id, sequence_number)
-- is the per-account monotone sequence the LedgerService relies on for
-- ordering + the hash chain.
--
-- DURABILITY: prev_hash + this_hash are the NEW columns the hash-chain sibling
-- depends on (tamper-evident chain). Nullable so this migration is safe over
-- pre-durability rows; the sibling backfills and begins writing them.
-- Post-once replay safety is the SEPARATE journal_idempotency table (0162),
-- per-JOURNAL grain — ledger_entries carries NO idempotency_key.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL,
  account_id                  TEXT NOT NULL,
  journal_id                  TEXT NOT NULL,
  type                        TEXT NOT NULL,
  direction                   TEXT NOT NULL,
  amount_minor_units          BIGINT NOT NULL,
  currency                    TEXT NOT NULL,
  balance_after_minor_units   BIGINT NOT NULL,
  sequence_number             INTEGER NOT NULL,
  effective_date              TIMESTAMPTZ NOT NULL,
  posted_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payment_intent_id           TEXT,
  lease_id                    TEXT,
  property_id                 TEXT,
  unit_id                     TEXT,
  invoice_id                  TEXT,
  description                 TEXT,
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Tamper-evidence chain (sibling-owned, nullable for legacy rows):
  prev_hash                   TEXT,
  this_hash                   TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT
);

-- Defensive: ensure the durability + Drizzle columns exist on a pre-existing
-- (archived-lineage) ledger_entries that predates them. Pure additive.
ALTER TABLE IF EXISTS ledger_entries
  ADD COLUMN IF NOT EXISTS journal_id        TEXT,
  ADD COLUMN IF NOT EXISTS direction         TEXT,
  ADD COLUMN IF NOT EXISTS sequence_number   INTEGER,
  ADD COLUMN IF NOT EXISTS effective_date    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_id          TEXT,
  ADD COLUMN IF NOT EXISTS property_id       TEXT,
  ADD COLUMN IF NOT EXISTS unit_id           TEXT,
  ADD COLUMN IF NOT EXISTS invoice_id        TEXT,
  ADD COLUMN IF NOT EXISTS metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prev_hash         TEXT,
  ADD COLUMN IF NOT EXISTS this_hash         TEXT,
  ADD COLUMN IF NOT EXISTS created_by        TEXT;

CREATE INDEX IF NOT EXISTS ledger_entries_tenant_idx         ON ledger_entries(tenant_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx        ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS ledger_entries_journal_idx        ON ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS ledger_entries_type_idx           ON ledger_entries(type);
CREATE INDEX IF NOT EXISTS ledger_entries_effective_date_idx ON ledger_entries(effective_date);
CREATE INDEX IF NOT EXISTS ledger_entries_payment_intent_idx ON ledger_entries(payment_intent_id);
CREATE INDEX IF NOT EXISTS ledger_entries_lease_idx          ON ledger_entries(lease_id);
CREATE INDEX IF NOT EXISTS ledger_entries_posted_at_idx      ON ledger_entries(posted_at);
CREATE INDEX IF NOT EXISTS ledger_entries_this_hash_idx      ON ledger_entries(this_hash);

DO $$
BEGIN
  -- Per-account monotone sequence (ordering + chain anchor).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'ledger_entries_account_sequence_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX ledger_entries_account_sequence_idx '
         || 'ON ledger_entries (account_id, sequence_number)';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — payment_intents
--
-- The "journal/payment_intents" leg: the inbound-money intent a journal of
-- ledger_entries settles against. All money columns are BIGINT minor units
-- (integer minor units, BIGINT storage). Column layout mirrors the
-- payments-ledger service's local Drizzle table
-- (services/payments-ledger/src/repositories/drizzle-schema.ts) byte-for-byte
-- on column names. idempotency_key already existed here as the post-once key;
-- it is restored + UNIQUE-indexed per (tenant_id, idempotency_key).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_intents (
  id                            TEXT PRIMARY KEY,
  tenant_id                     TEXT NOT NULL,
  customer_id                   TEXT NOT NULL,
  lease_id                      TEXT,
  type                          TEXT NOT NULL,
  status                        TEXT NOT NULL,
  amount_minor_units            BIGINT NOT NULL,
  currency                      TEXT NOT NULL,
  platform_fee_minor_units      BIGINT,
  net_amount_minor_units        BIGINT,
  provider_name                 TEXT,
  external_id                   TEXT,
  description                   TEXT,
  statement_descriptor          TEXT,
  idempotency_key               TEXT,
  receipt_url                   TEXT,
  refunded_amount_minor_units   BIGINT DEFAULT 0,
  failure_reason                TEXT,
  paid_at                       TIMESTAMPTZ,
  refunded_at                   TIMESTAMPTZ,
  cancelled_at                  TIMESTAMPTZ,
  metadata                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                    TEXT,
  updated_by                    TEXT
);

-- Defensive additive for a pre-existing payment_intents.
ALTER TABLE IF EXISTS payment_intents
  ADD COLUMN IF NOT EXISTS platform_fee_minor_units    BIGINT,
  ADD COLUMN IF NOT EXISTS net_amount_minor_units      BIGINT,
  ADD COLUMN IF NOT EXISTS statement_descriptor        TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key             TEXT,
  ADD COLUMN IF NOT EXISTS receipt_url                 TEXT,
  ADD COLUMN IF NOT EXISTS refunded_amount_minor_units BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason              TEXT,
  ADD COLUMN IF NOT EXISTS paid_at                     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by                  TEXT,
  ADD COLUMN IF NOT EXISTS updated_by                  TEXT;

CREATE INDEX IF NOT EXISTS payment_intents_tenant_idx   ON payment_intents(tenant_id);
CREATE INDEX IF NOT EXISTS payment_intents_customer_idx ON payment_intents(customer_id);
CREATE INDEX IF NOT EXISTS payment_intents_lease_idx    ON payment_intents(lease_id);
CREATE INDEX IF NOT EXISTS payment_intents_status_idx   ON payment_intents(status);

DO $$
BEGIN
  -- Tenant-scoped provider lookup key (mirrors archived 0169b widening:
  -- UNIQUE (tenant_id, provider_name, external_id) — never bare external_id,
  -- so a leaked external_id from tenant A can't reach tenant B's row).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'payment_intents_external_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX payment_intents_external_idx '
         || 'ON payment_intents (tenant_id, provider_name, external_id) '
         || 'WHERE external_id IS NOT NULL AND provider_name IS NOT NULL';
  END IF;

  -- Post-once idempotency per tenant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'payment_intents_idempotency_idx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX payment_intents_idempotency_idx '
         || 'ON payment_intents (tenant_id, idempotency_key) '
         || 'WHERE idempotency_key IS NOT NULL';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- §3a — Money columns: INTEGER -> BIGINT safety conversion.
--
-- The CREATE TABLE / ADD COLUMN statements above mint these *_minor_units
-- money columns as BIGINT on a FRESH database. But a pre-existing
-- archived-lineage table (0001c / 0167b / 0174) already HOLDS them as INTEGER
-- (int4, max 2,147,483,647), and ADD COLUMN IF NOT EXISTS is a no-op on a
-- column that already exists — it will NOT widen the type. INTEGER whole-TZS
-- is a guaranteed outage: a single realistic gold/tanzanite settlement
-- (~2.147e9 TZS ≈ USD 820k) overflows int4 with Postgres 22003
-- numeric_value_out_of_range, and the shared clearing/payable balances
-- ACCUMULATE past it with volume. settlements were already widened in 0161;
-- the ledger tables they feed MUST match.
--
-- This block ALTERs each money column to BIGINT in place. Mirrors 0161's
-- information_schema-guarded style: it fires ONLY while the column is present
-- and NOT already bigint, so a re-run (or a DB already on bigint — including
-- the fresh-install case the CREATE TABLE just handled) is a harmless no-op.
-- INTEGER -> BIGINT is a widening cast that cannot lose data and needs no
-- USING expression. entry_count / sequence_number are COUNTS, not money, and
-- are deliberately left INTEGER. Inside the migration's BEGIN/COMMIT;
-- idempotent + forward-only per CLAUDE.md "Migrations are immutable".
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  -- (table_name, money column) pairs to ensure are BIGINT.
  money_targets text[][] := ARRAY[
    ARRAY['accounts',        'balance_minor_units'],
    ARRAY['ledger_entries',  'amount_minor_units'],
    ARRAY['ledger_entries',  'balance_after_minor_units'],
    ARRAY['payment_intents', 'amount_minor_units'],
    ARRAY['payment_intents', 'platform_fee_minor_units'],
    ARRAY['payment_intents', 'net_amount_minor_units'],
    ARRAY['payment_intents', 'refunded_amount_minor_units']
  ];
  target text[];
  tbl text;
  col text;
  cur_type text;
BEGIN
  FOREACH target SLICE 1 IN ARRAY money_targets LOOP
    tbl := target[1];
    col := target[2];

    SELECT data_type
      INTO cur_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = tbl
       AND column_name  = col;

    -- Convert only if the column is present and not already bigint.
    -- information_schema reports bigint as 'bigint', int4 as 'integer'.
    IF cur_type IS NOT NULL AND cur_type <> 'bigint' THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE bigint;',
        tbl, col
      );
      RAISE NOTICE '%.% converted % -> bigint (whole TZS minor units)', tbl, col, cur_type;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §4 — FORCE RLS + tenant-isolation policy on all three money tables.
--
-- Mirrors 0157's CORRECT GUC: current_setting('app.current_tenant_id', true).
-- tenant_id is TEXT on these tables so the compare is bare (no ::text cast).
-- FOR ALL covers the service's INSERT/UPDATE paths (balance roll-forward,
-- account close); the ledger remains append-mostly by application discipline.
-- Idempotent: ENABLE/FORCE are no-ops if already set; policy guarded by
-- pg_policies existence check. REVOKE anon defence-in-depth.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY['accounts', 'ledger_entries', 'payment_intents'];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = tbl
          AND policyname = tbl || '_tenant_isolation'
      ) THEN
        EXECUTE format($pol$
          CREATE POLICY %I ON public.%I
          FOR ALL
          USING (tenant_id = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
        $pol$, tbl || '_tenant_isolation', tbl);
      END IF;

      -- anon role is a Supabase construct; guard so the migration still
      -- applies on a vanilla Postgres (CI empty-PG check / non-Supabase env).
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE accounts IS
  'Double-entry account register (money path via LedgerService.post()). '
  'balance_minor_units is BIGINT minor units (integer minor units, BIGINT '
  'storage so an accumulating balance cannot overflow INTEGER). Tenant-scoped '
  'RLS FORCE on app.current_tenant_id. Restored to live migrations in 0160.';

COMMENT ON TABLE ledger_entries IS
  'Append-only double-entry lines. amount/balance_after in BIGINT minor '
  'units (integer minor units, BIGINT storage). (account_id, sequence_number) '
  'is the per-account monotone sequence; prev_hash/this_hash are the '
  'tamper-evidence chain. Post-once idempotency is the separate '
  'journal_idempotency table (0162). RLS FORCE on app.current_tenant_id. '
  'Restored to live migrations in 0160.';

COMMENT ON TABLE payment_intents IS
  'Inbound-money intent a journal of ledger_entries settles against. All '
  'money columns BIGINT minor units (integer minor units, BIGINT storage). '
  'Provider lookup scoped to (tenant_id, provider_name, external_id). RLS '
  'FORCE on app.current_tenant_id. Restored to live migrations in 0160.';

COMMIT;
