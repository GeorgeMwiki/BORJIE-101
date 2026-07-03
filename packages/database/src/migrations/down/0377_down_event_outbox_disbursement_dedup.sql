-- =============================================================================
-- Down-migration 0377 — drop the event_outbox disbursement dedup UNIQUE index.
--
-- Dev/staging only. Reverses 0377 by dropping
-- event_outbox_disbursement_dedup_uniq. WARNING: this RE-OPENS the
-- monthly-close double-pay window — an orchestrator retry of the same
-- run+owner can again insert a second `MonthlyCloseDisbursementProposed`
-- proposal and the owner is disbursed twice. The one-time duplicate dedupe the
-- up-migration performed is NOT reversible (the duplicate rows were deleted);
-- the down only restores the pre-0377 index shape. Pure structural metadata —
-- no live data touched by the drop. Do not run against production.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS event_outbox_disbursement_dedup_uniq;

COMMIT;
