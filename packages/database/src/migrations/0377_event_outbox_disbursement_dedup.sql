-- =============================================================================
-- Migration 0377 — event_outbox: UNIQUE dedup key for monthly-close
-- disbursement proposals (closes a REAL-MONEY double-pay via duplicate
-- producer proposals).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The monthly-close orchestrator's DisbursementPort adapter
-- (services/api-gateway/src/services/monthly-close/disbursement-adapter.ts)
-- records each owner payout by INSERTing a `MonthlyCloseDisbursementProposed`
-- row into `event_outbox`, keyed by `correlation_id = idempotencyKey`
-- (`${run.id}:${ownerId}`). But `event_outbox_correlation_idx` (migration
-- 0305) is a NON-UNIQUE btree, so an orchestrator retry of the SAME run+owner
-- inserts a SECOND proposal row. The payouts worker then drains BOTH and the
-- owner is DISBURSED TWICE — real money out, no guard.
--
-- THE FIX: a PARTIAL UNIQUE index on (tenant_id, event_type, correlation_id)
-- scoped by `WHERE event_type = 'MonthlyCloseDisbursementProposed'`. Scoping
-- to that single event type is deliberate and load-bearing:
--   * it makes a duplicate disbursement proposal impossible (the producer's
--     new ON CONFLICT ... DO NOTHING lands on this exact key), while
--   * NOT constraining ANY other event type — other producers (e.g.
--     `settlement.requested`) may legitimately share a correlation_id across
--     rows and MUST NOT be affected. A table-wide unique on those three
--     columns would break them; the WHERE clause confines this constraint to
--     the disbursement lane only.
-- correlation_id is NOT NULL for every disbursement proposal the adapter
-- writes (it always passes the idempotencyKey), so the partial index covers
-- every row in that lane. tenant_id is included first so the key is
-- tenant-scoped (defence in depth even though idempotencyKey embeds run.id).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): the table is guarded by
-- to_regclass; the index uses CREATE UNIQUE INDEX IF NOT EXISTS so re-run is a
-- no-op. A pre-flight dedupe collapses any pre-existing duplicate proposals
-- (keeping the earliest row per key) so the UNIQUE index can be built on a
-- dirty table without failing — the surviving row is the one the worker would
-- have processed first; the duplicate(s) are the double-pay rows we are
-- eliminating. Pure structural + one-time dedupe; forward-only, immutable.
--
-- Companion files:
--   * packages/database/src/migrations/0305_create_missing_schema_tables.sql (table)
--   * packages/database/src/migrations/0376_event_outbox_service_role_bypass.sql (RLS twin)
--   * services/api-gateway/src/services/monthly-close/disbursement-adapter.ts (ON CONFLICT producer)
--   * packages/database/src/migrations/down/0377_down_event_outbox_disbursement_dedup.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.event_outbox') IS NULL THEN
    RAISE NOTICE 'event_outbox table absent — skipping disbursement dedup index (fresh-DB guard)';
    RETURN;
  END IF;

  -- One-time dedupe: collapse any pre-existing duplicate disbursement
  -- proposals so the UNIQUE index can build. Keep the EARLIEST row per
  -- (tenant_id, correlation_id) — that is the one the worker drains first;
  -- the later duplicate(s) are exactly the double-pay rows. Only touch rows
  -- that have NOT already been dispatched (status pending / processing) so we
  -- never rewrite history for a row that already moved money; a published /
  -- dead_letter duplicate is left in place (the UNIQUE build would then fail
  -- loudly, which is the correct signal that a double-pay already occurred and
  -- needs manual reconciliation rather than silent index creation).
  DELETE FROM event_outbox e
  USING (
    SELECT id,
           row_number() OVER (
             PARTITION BY tenant_id, correlation_id
             ORDER BY created_at ASC, id ASC
           ) AS rn
      FROM event_outbox
     WHERE event_type = 'MonthlyCloseDisbursementProposed'
       AND correlation_id IS NOT NULL
       AND status = 'pending'
  ) dup
  WHERE e.id = dup.id
    AND dup.rn > 1;

  CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_disbursement_dedup_uniq
    ON event_outbox (tenant_id, event_type, correlation_id)
    WHERE event_type = 'MonthlyCloseDisbursementProposed'
      AND correlation_id IS NOT NULL;
END $$;

COMMIT;
