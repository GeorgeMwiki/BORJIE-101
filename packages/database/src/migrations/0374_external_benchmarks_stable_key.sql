-- =============================================================================
-- 0374: external_benchmarks — a STABLE idempotency key that survives re-apply.
--
-- WHY 0373 DID NOT ACTUALLY MAKE 0371 IDEMPOTENT
--   0371 seeds external_benchmarks with `as_of = NOW() - INTERVAL 'N days'`.
--   That expression is evaluated at APPLY TIME, so `as_of` ADVANCES on every
--   re-run. 0373's unique key is (source, metric_id, as_of) — because `as_of`
--   is different on each apply, the seed's `ON CONFLICT DO NOTHING` NEVER
--   conflicts, and 0371 DUPLICATES every market row on each re-apply. The
--   scanner reads `ORDER BY as_of DESC` (latest per metric_id, and a 30-row
--   series for lbma_am_usd_per_oz) so duplicated rows SKEW the benchmark
--   aggregates — the exact false-green 0373 claimed to close, still open.
--
-- WHY THE KEY IS (source, metric_id, value) AND NOT (source, metric_id)
--   Most metrics are read `LIMIT 1` (one current value per metric per source),
--   for which (source, metric_id) would be the natural key. BUT one metric,
--   `lbma_am_usd_per_oz`, is intentionally seeded as a 30-row DAILY SERIES and
--   the FX slice reads it with `ORDER BY as_of DESC LIMIT 30` to compute a
--   rolling mean + stdev (services/api-gateway/src/services/opportunity-scanner
--   /resolver.ts:134-150). A bare (source, metric_id) UNIQUE would COLLAPSE that
--   series to a single row → stdev = 0 → the FX volatility slice silently breaks.
--   That is a live consumer we must not narrow.
--
--   The correct drift-STABLE discriminator is the seeded `value` itself: every
--   series row carries a distinct sourced constant (4102.10, 4088.40, …) and
--   every single-value metric has exactly one row, so (source, metric_id, value)
--   is UNIQUE across the whole 0371 seed AND is invariant across re-applies
--   (value is a fixed constant, unlike as_of = NOW()-…). Re-seeding therefore
--   conflicts on this key and DO-NOTHINGs — true idempotency — while the LBMA
--   history series is preserved intact.
--
-- WHAT THIS MIGRATION DOES (idempotent, guarded, forward-only)
--   (a) DEDUPE external_benchmarks keeping the LATEST as_of per
--       (source, metric_id, value) — collapses duplicates already introduced by
--       prior 0371 re-applies while keeping the freshest as_of for each real row.
--   (b) DROP 0373's (source, metric_id, as_of) unique constraint (the drifting
--       key that never conflicted).
--   (c) ADD a UNIQUE (source, metric_id, value) constraint so 0371's bare
--       `ON CONFLICT DO NOTHING` now genuinely no-ops on re-apply.
--
--   Never edits shipped 0095 / 0371 / 0373. Safe to re-run (dedupe is a no-op on
--   clean data; both constraint ops are existence-guarded).
-- =============================================================================

BEGIN;

-- (a) DEDUPE — keep the row with the LATEST as_of per (source, metric_id, value).
--     Ties on as_of are broken by the physical ctid so exactly one row survives.
DELETE FROM external_benchmarks a
USING external_benchmarks b
WHERE a.source = b.source
  AND a.metric_id = b.metric_id
  AND a.value = b.value
  AND (
        a.as_of < b.as_of
        OR (a.as_of = b.as_of AND a.ctid > b.ctid)
      );

-- (b) DROP the drifting (source, metric_id, as_of) key 0373 added — it can never
--     fire against the NOW()-based seed, so it does not enforce idempotency.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'external_benchmarks_source_metric_asof_uk'
  ) THEN
    ALTER TABLE external_benchmarks
      DROP CONSTRAINT external_benchmarks_source_metric_asof_uk;
  END IF;
END $$;

-- (c) ADD the drift-STABLE (source, metric_id, value) unique key. Now the 0371
--     seed's ON CONFLICT DO NOTHING conflicts on re-apply and is a true no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'external_benchmarks_source_metric_value_uk'
  ) THEN
    ALTER TABLE external_benchmarks
      ADD CONSTRAINT external_benchmarks_source_metric_value_uk
      UNIQUE (source, metric_id, value);
  END IF;
END $$;

COMMIT;
