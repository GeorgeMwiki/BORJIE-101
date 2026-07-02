-- Down for 0374: revert the external_benchmarks idempotency key from the
-- drift-stable (source, metric_id, value) back to 0373's (source, metric_id,
-- as_of) shape.
--
-- Dev/staging only. The de-duplication the up-migration performed is NOT
-- reversible (duplicate rows were removed); this only swaps the constraints
-- back so the table shape matches its pre-0374 (post-0373) state.
--
-- Note: re-adding the (source, metric_id, as_of) key can fail if the table now
-- holds two rows sharing (source, metric_id, as_of) — impossible on data that
-- passed through 0373 + 0374 cleanly, but guarded so the down is safe to re-run.

BEGIN;

-- Drop the stable value key 0374 added.
ALTER TABLE external_benchmarks
  DROP CONSTRAINT IF EXISTS external_benchmarks_source_metric_value_uk;

-- Restore 0373's (source, metric_id, as_of) key (existence-guarded).
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
