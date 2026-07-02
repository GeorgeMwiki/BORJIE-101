-- 0373: external_benchmarks idempotency key.
--
-- The market-reference seed in 0371 uses `INSERT ... ON CONFLICT DO NOTHING`
-- and its header claims idempotency, but external_benchmarks (0095) has its
-- ONLY unique key on the PK `id` (a fresh gen_random_uuid() per row). A
-- no-target ON CONFLICT can therefore never fire, so re-applying 0371
-- DUPLICATES every market row and skews the scanner's benchmark aggregates.
--
-- Fix the CLASS: add the real unique key the seed's ON CONFLICT relies on —
-- (source, metric_id, as_of) — so a re-apply is a genuine no-op. Dedupe any
-- pre-existing duplicates first (keep the earliest row per key) so the
-- constraint add cannot fail. Never edits shipped 0095/0371.
--
-- Idempotent + safe to re-run (dedupe is a no-op on clean data; the
-- constraint add is guarded by pg_constraint existence).

BEGIN;

-- 1. Dedupe: keep the physically-earliest row per (source, metric_id, as_of).
DELETE FROM external_benchmarks a
USING external_benchmarks b
WHERE a.source = b.source
  AND a.metric_id = b.metric_id
  AND a.as_of = b.as_of
  AND a.ctid > b.ctid;

-- 2. Add the unique key the idempotent seed needs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'external_benchmarks_source_metric_asof_uk'
  ) THEN
    ALTER TABLE external_benchmarks
      ADD CONSTRAINT external_benchmarks_source_metric_asof_uk
      UNIQUE (source, metric_id, as_of);
  END IF;
END $$;

COMMIT;
