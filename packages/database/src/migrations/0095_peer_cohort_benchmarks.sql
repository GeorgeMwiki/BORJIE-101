-- =============================================================================
-- Migration 0095 — Peer Cohort Benchmarks + External Benchmarks
--
-- Wave: MD-INTELLIGENCE. Two read-only baselines that turn "AI assistant"
-- into "AI Managing Director":
--
--   peer_cohort_aggregates  — anonymised per-cohort percentile bands
--                             (p25 / p50 / p75) used by the comparison
--                             framework. Cohort key encodes
--                             "TZ_artisanal_gold", "TZ_mid_tier_copper",
--                             etc. Sample size guards thin cohorts.
--   external_benchmarks     — point-in-time external reference values
--                             (LBMA gold AM, BoT lending rate, TRA
--                             royalty schedule, NEMC compliance baseline,
--                             etc.). Joined to a metric_id and an as_of
--                             timestamp.
--
-- Neither table is tenant-scoped; both are READ-ONLY for tenants. The
-- gateway exposes them via the comparison-framework service module.
--
-- Companion to:
--   - packages/database/src/schemas/peer-cohort-benchmarks.schema.ts
--   - services/api-gateway/src/services/md-intelligence/comparison-framework.ts
--
-- INVARIANTS
--   - Idempotent — safe to re-run.
--   - Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) peer_cohort_aggregates — anonymised percentile bands by cohort + metric.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS peer_cohort_aggregates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Cohort key encodes country + scale + commodity, e.g.
   *  "TZ_artisanal_gold", "TZ_mid_tier_copper", "TZ_smallscale_tanzanite". */
  cohort_key      text        NOT NULL,
  metric_id       text        NOT NULL,
  percentile_p25  numeric(20,4) NOT NULL,
  percentile_p50  numeric(20,4) NOT NULL,
  percentile_p75  numeric(20,4) NOT NULL,
  sample_size     integer     NOT NULL,
  unit            text,
  notes           text,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pca_uniq_cohort_metric'
  ) THEN
    ALTER TABLE peer_cohort_aggregates
      ADD CONSTRAINT pca_uniq_cohort_metric
      UNIQUE (cohort_key, metric_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pca_sample_size_chk'
  ) THEN
    ALTER TABLE peer_cohort_aggregates
      ADD CONSTRAINT pca_sample_size_chk
      CHECK (sample_size >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pca_cohort_metric
  ON peer_cohort_aggregates (cohort_key, metric_id);

-- READ ONLY for tenants. Not RLS-tenant-scoped because the data is
-- anonymised aggregate.

-- -----------------------------------------------------------------------------
-- 2) external_benchmarks — point-in-time external reference values.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS external_benchmarks (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text          NOT NULL,
  metric_id   text          NOT NULL,
  value       numeric(20,6) NOT NULL,
  unit        text,
  as_of       timestamptz   NOT NULL,
  lat_long    text,
  region      text,
  notes       text,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eb_source_chk'
  ) THEN
    ALTER TABLE external_benchmarks
      ADD CONSTRAINT eb_source_chk
      CHECK (source IN (
        'LBMA', 'BoT', 'TRA', 'NEMC', 'OSHA', 'TCRA', 'TBS', 'ICA',
        'WORLD_BANK', 'IMF', 'OTHER'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_eb_metric_as_of
  ON external_benchmarks (metric_id, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_eb_source_metric
  ON external_benchmarks (source, metric_id);

-- -----------------------------------------------------------------------------
-- 3) Seed realistic data for the most-demoed metrics. Safe re-run via
--    ON CONFLICT DO NOTHING.
-- -----------------------------------------------------------------------------

INSERT INTO peer_cohort_aggregates
  (cohort_key, metric_id, percentile_p25, percentile_p50, percentile_p75, sample_size, unit)
VALUES
  ('TZ_artisanal_gold', 'tonnes_per_shift_per_pit', 1.2, 2.4, 4.1, 38, 'tonnes'),
  ('TZ_artisanal_gold', 'incident_rate_per_1000h', 0.6, 1.4, 3.2, 38, 'count'),
  ('TZ_artisanal_gold', 'fuel_consumption_l_per_t', 1.8, 2.6, 3.7, 38, 'litres/tonne'),
  ('TZ_artisanal_gold', 'recovery_pct', 78.0, 84.0, 88.0, 38, 'pct'),
  ('TZ_mid_tier_copper', 'tonnes_per_shift_per_pit', 18.0, 32.0, 51.0, 12, 'tonnes'),
  ('TZ_mid_tier_copper', 'incident_rate_per_1000h', 0.4, 1.0, 2.1, 12, 'count')
ON CONFLICT (cohort_key, metric_id) DO NOTHING;

INSERT INTO external_benchmarks
  (source, metric_id, value, unit, as_of, region)
VALUES
  ('LBMA', 'gold_am_usd_per_oz', 2415.50, 'USD/oz', NOW() - INTERVAL '1 day', NULL),
  ('BoT', 'lending_rate_pct_annual', 16.50, 'pct', NOW() - INTERVAL '7 days', 'TZ'),
  ('TRA', 'mineral_royalty_pct_gold', 7.00, 'pct', NOW() - INTERVAL '90 days', 'TZ'),
  ('NEMC', 'eia_review_window_days', 45, 'days', NOW() - INTERVAL '30 days', 'TZ'),
  ('OSHA', 'reportable_threshold_lost_days', 3, 'days', NOW() - INTERVAL '180 days', 'TZ'),
  ('TBS', 'assay_certificate_validity_days', 90, 'days', NOW() - INTERVAL '365 days', 'TZ')
ON CONFLICT DO NOTHING;

COMMIT;
