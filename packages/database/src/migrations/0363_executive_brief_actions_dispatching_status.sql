-- =============================================================================
-- Migration 0363 — allow the transient 'dispatching' status on
-- executive_brief_actions (co-requirement of the multi-replica atomic-claim fix).
--
-- WHY: the executive-brief-action-runner now claims approved rows with an atomic
-- single-winner UPDATE that sets status='dispatching' (so two replicas cannot
-- double-dispatch). The existing status CHECK only permits
-- ('pending','approved','executed','failed','rejected'), so every claim UPDATE
-- would throw 23514 and the worker would go fully dark. This extends the CHECK.
--
-- Safe-class: drops + re-adds a single CHECK constraint, idempotent + guarded,
-- no data touched (no existing row holds 'dispatching'). Forward-only.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.executive_brief_actions') IS NOT NULL THEN
    ALTER TABLE executive_brief_actions
      DROP CONSTRAINT IF EXISTS executive_brief_actions_status_chk;
    ALTER TABLE executive_brief_actions
      ADD CONSTRAINT executive_brief_actions_status_chk
      CHECK (status = ANY (ARRAY[
        'pending', 'approved', 'dispatching', 'executed', 'failed', 'rejected'
      ]));
  END IF;
END $$;

COMMIT;
