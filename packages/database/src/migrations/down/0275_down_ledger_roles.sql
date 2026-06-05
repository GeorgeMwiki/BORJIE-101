-- =============================================================================
-- DOWN 0275: revert ledger write-role separation (LP-20c).
--
-- NO DATA LOSS: this reverses privilege plumbing only — it drops the two
-- NOLOGIN group roles and their grants. No table, row, or column is touched.
-- Safe on dev / staging. On prod, only run after confirming no LOGIN user
-- still depends on these roles (revoke membership first), else the DROP ROLE
-- fails with "role cannot be dropped because some objects depend on it".
--
-- Reverses 0275_ledger_roles.sql:
--   - REVOKE all grants held by the two roles (so DROP ROLE succeeds)
--   - DROP ROLE borjie_ledger_writer / borjie_ledger_reader
--
-- Idempotent: guarded by pg_roles existence + to_regclass so it is safe to
-- re-run and safe whether or not the money tables exist.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  money_tables text[] :=
    ARRAY['ledger_entries', 'settlements', 'disbursements', 'payment_intents', 'accounts'];
  tbl text;
  r record;
BEGIN
  -- Drop grants on the money tables (if present) for both roles.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'borjie_ledger_writer') THEN
    FOREACH tbl IN ARRAY money_tables LOOP
      IF to_regclass('public.' || tbl) IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM borjie_ledger_writer;', tbl);
      END IF;
    END LOOP;
    -- Drop any sequence grants the up-migration may have issued.
    FOR r IN
      SELECT n.nspname AS s, c.relname AS seq
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'S' AND n.nspname = 'public'
    LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE %I.%I FROM borjie_ledger_writer;', r.s, r.seq);
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'borjie_ledger_reader') THEN
    FOREACH tbl IN ARRAY money_tables LOOP
      IF to_regclass('public.' || tbl) IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM borjie_ledger_reader;', tbl);
      END IF;
    END LOOP;
  END IF;
END $$;

DROP ROLE IF EXISTS borjie_ledger_writer;
DROP ROLE IF EXISTS borjie_ledger_reader;

COMMIT;
