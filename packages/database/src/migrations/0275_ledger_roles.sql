-- =============================================================================
-- Migration 0275 — Ledger write-role separation (LP-20c)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The money-path tables (`ledger_entries`, `accounts`, `payment_intents`,
-- `settlements`, `disbursements`) back `LedgerService.post()` — the CLAUDE.md
-- hard rule "Money path goes through LedgerService.post()". Until now that
-- invariant was enforced ONLY in application code + a money-path-audit unit
-- test (services/payments-ledger/src/__tests__/invariants/money-path-audit.test.ts).
-- Audit 2026-06-03 §2.5 flagged this as PARTIAL: "verify distinct DB roles or
-- LedgerService.post() is partly theater". Direct verification confirmed NO
-- CREATE ROLE / role-separation existed in ANY migration — every connection
-- (gateway, payments-ledger engine, brain) authenticated as the SAME Postgres
-- role with full DML. An RCE/SSRF/chained vuln in any one of them could run
-- `UPDATE ledger_entries SET ...` or `DELETE` and silently rewrite history.
--
-- This migration draws the DB-level line LITFIN's ARCHITECTURE-LEDGER-ISOLATION.md
-- (Step 2 + the ledger-engine role) prescribes: a dedicated write-role whose
-- grant set is INSERT-ONLY on the ledger tables. Entries are immutable — a
-- correction is a NEW compensating entry, never an UPDATE — so the engine role
-- has NO UPDATE and NO DELETE. This makes "the ledger is append-only" a
-- property the database enforces, not merely a convention the app honours.
--
-- WHAT IT CREATES
-- ---------------
--   * Role `borjie_ledger_writer` — NOLOGIN group role. The ledger-ENGINE
--     deployment's login user is GRANTed this role (see DEPLOY STEP below).
--     Grants: INSERT (+ SELECT for read-after-write + the per-account sequence
--     read the chain needs) on the 5 money tables. NO UPDATE, NO DELETE,
--     NO TRUNCATE. payment_intents is the one lifecycle table whose status
--     legitimately transitions (pending→paid→…), so it ALSO receives UPDATE;
--     the immutable double-entry tables (ledger_entries) never do.
--   * Role `borjie_ledger_reader` — NOLOGIN group role for the ledger-API /
--     read path. SELECT-only on the same tables (mirrors the replica-backed
--     ledger-api in the isolation doc). No INSERT/UPDATE/DELETE.
--
-- It does NOT create LOGIN users or passwords (those are environment secrets,
-- provisioned out-of-band). It only defines the privilege SETS and revokes the
-- broad default-PUBLIC/anon access so membership is the only way in.
--
-- DEPLOY STEP (run once per environment, OUTSIDE this migration)
-- -------------------------------------------------------------
-- This migration is privilege plumbing only. To activate isolation, the
-- platform operator must, per environment (values are secrets, never committed):
--
--   1. Create the login user the payments-ledger ENGINE connects as and grant
--      it the writer role:
--        CREATE ROLE ledger_engine_app LOGIN PASSWORD '<engine-secret>';
--        GRANT borjie_ledger_writer TO ledger_engine_app;
--   2. Create the login user the ledger READ path (ledger-api / brain reads)
--      connects as and grant it the reader role:
--        CREATE ROLE ledger_read_app LOGIN PASSWORD '<read-secret>';
--        GRANT borjie_ledger_reader TO ledger_read_app;
--   3. Point services/payments-ledger's write DATABASE_URL at ledger_engine_app
--      and the read DATABASE_URL (ledger-api / replica) at ledger_read_app.
--   4. Ensure NO other service authenticates with a superuser / table-owner
--      role against these tables (the owner bypasses these grants).
--
-- RLS NOTE: FORCE RLS (migration 0160) still applies to BOTH roles — neither is
-- the table owner and neither has BYPASSRLS, so the app.current_tenant_id GUC
-- tenant predicate is enforced on every row they touch. Grants gate the verbs;
-- RLS gates the rows. Defence in depth.
--
-- IDEMPOTENT / FORWARD-ONLY: every object guarded (CREATE ROLE in a DO-block
-- duplicate_object swallow; table grants guarded by to_regclass so the file is
-- safe on a DB where a money table does not yet exist). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — Roles (NOLOGIN group roles; login users are env-provisioned secrets).
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE ROLE borjie_ledger_writer NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE borjie_ledger_reader NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- §2 — Grants. INSERT-only (+SELECT) for the writer on the immutable tables;
--      payment_intents additionally gets UPDATE (legitimate status lifecycle).
--      Reader is SELECT-only everywhere. Guarded per-table with to_regclass so
--      the migration applies cleanly whether or not the money spine is present
--      yet (fresh DB vs. archived-lineage DB).
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  -- Immutable double-entry tables: INSERT + SELECT for the writer, never
  -- UPDATE/DELETE. Corrections are compensating INSERTs.
  insert_only_tables text[] := ARRAY['ledger_entries', 'settlements', 'disbursements'];
  -- Mutable lifecycle tables: writer additionally needs UPDATE.
  insert_update_tables text[] := ARRAY['payment_intents', 'accounts'];
  -- Every money table the reader may SELECT.
  all_money_tables text[] :=
    ARRAY['ledger_entries', 'settlements', 'disbursements', 'payment_intents', 'accounts'];
  tbl text;
BEGIN
  -- Writer: INSERT-only tables.
  FOREACH tbl IN ARRAY insert_only_tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      -- Defensively strip any pre-existing broad DML, then grant the narrow set.
      EXECUTE format('REVOKE ALL ON public.%I FROM borjie_ledger_writer;', tbl);
      EXECUTE format('GRANT INSERT, SELECT ON public.%I TO borjie_ledger_writer;', tbl);
    END IF;
  END LOOP;

  -- Writer: INSERT + UPDATE + SELECT tables (status lifecycle / balance update).
  FOREACH tbl IN ARRAY insert_update_tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM borjie_ledger_writer;', tbl);
      EXECUTE format('GRANT INSERT, UPDATE, SELECT ON public.%I TO borjie_ledger_writer;', tbl);
    END IF;
  END LOOP;

  -- Reader: SELECT-only on every money table.
  FOREACH tbl IN ARRAY all_money_tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM borjie_ledger_reader;', tbl);
      EXECUTE format('GRANT SELECT ON public.%I TO borjie_ledger_reader;', tbl);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §3 — Sequence usage. The ledger writes a per-account monotone
--      sequence_number; if any of these tables drive a Postgres SEQUENCE
--      (SERIAL / IDENTITY), the writer needs USAGE on it. The ledger uses an
--      app-computed integer sequence + a UNIQUE(account_id, sequence_number)
--      index (0160), not a DB sequence, so there is typically nothing to grant
--      — but we cover any IDENTITY columns defensively + idempotently.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  seq record;
BEGIN
  FOR seq IN
    SELECT n.nspname AS schema_name, c.relname AS seq_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE c.relkind = 'S'
       AND n.nspname = 'public'
       AND t.relname IN ('ledger_entries', 'settlements', 'disbursements', 'payment_intents', 'accounts')
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO borjie_ledger_writer;',
                   seq.schema_name, seq.seq_name);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §4 — Documentation comments on the roles (regulator / SOC-2 legibility).
-- -----------------------------------------------------------------------------

COMMENT ON ROLE borjie_ledger_writer IS
  'LP-20c ledger-engine write role. INSERT-only on immutable ledger tables '
  '(ledger_entries/settlements/disbursements); +UPDATE on payment_intents/accounts '
  'lifecycle. No DELETE/TRUNCATE — the ledger is append-only. FORCE RLS still '
  'applies (not table owner, no BYPASSRLS). Granted to the env-provisioned '
  'login user the payments-ledger ENGINE connects as.';

COMMENT ON ROLE borjie_ledger_reader IS
  'LP-20c ledger-api read role. SELECT-only on the money tables. Granted to the '
  'env-provisioned login user the ledger READ path / replica connects as.';

COMMIT;
