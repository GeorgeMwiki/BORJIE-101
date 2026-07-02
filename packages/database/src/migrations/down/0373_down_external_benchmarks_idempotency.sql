-- Down for 0373: drop the external_benchmarks idempotency key.
-- Dev/staging only. The de-duplication in the up-migration is NOT reversible
-- (the duplicate rows were removed); this only drops the constraint so the
-- table shape matches its pre-0373 state.
ALTER TABLE external_benchmarks
  DROP CONSTRAINT IF EXISTS external_benchmarks_source_metric_asof_uk;
