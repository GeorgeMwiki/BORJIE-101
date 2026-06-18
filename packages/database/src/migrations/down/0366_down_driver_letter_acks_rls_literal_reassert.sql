-- =============================================================================
-- Down 0366 — NO-OP.
--
-- Migration 0366 only RE-ASSERTS, in the literal form the rls-coverage static
-- analyzer recognises, the RLS that migration 0362 already installed on
-- driver_letter_acks. It owns no unique schema or policy state: its
-- DROP-then-CREATE replaced 0362's policies with bit-identical ones, so after
-- 0366 there is still exactly one `driver_letter_acks_tenant_isolation` and one
-- `driver_letter_acks_service_role_bypass` policy.
--
-- Reverting 0366 must therefore leave RLS fully intact — the tenant-isolation
-- guarantee is owned by 0362, whose OWN down migration is what reverses it.
-- Dropping the policies here would strip the only copy and leave the table
-- "RLS enabled, no policy" (a CRITICAL gate state + deny-all). So this is the
-- explicit, registered no-op: the down-runner gets a reversible step that
-- changes nothing.
--
-- Dev/staging only. Pure metadata. No data touched. No money/licence/ledger.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  RAISE NOTICE '0366 down: no-op — RLS on driver_letter_acks is owned by 0362; nothing unique to reverse.';
END $$;

COMMIT;
