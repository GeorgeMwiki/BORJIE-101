/**
 * Peer cohort + external benchmarks — Wave MD-INTELLIGENCE.
 *
 * Two read-only tables that turn "AI assistant" into "AI Managing
 * Director":
 *
 *   peer_cohort_aggregates  anonymised per-cohort percentile bands
 *   external_benchmarks     point-in-time external reference values
 *
 * Companion to:
 *   - packages/database/src/migrations/0095_peer_cohort_benchmarks.sql
 *   - services/api-gateway/src/services/md-intelligence/comparison-framework.ts
 */

import {
  pgTable,
  text,
  numeric,
  integer,
  timestamp,
  uuid,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// peer_cohort_aggregates
// ============================================================================

export const peerCohortAggregates = pgTable(
  'peer_cohort_aggregates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Cohort key encodes country + scale + commodity, e.g.
     *  "TZ_artisanal_gold", "TZ_mid_tier_copper", "TZ_smallscale_tanzanite". */
    cohortKey: text('cohort_key').notNull(),
    metricId: text('metric_id').notNull(),
    percentileP25: numeric('percentile_p25', { precision: 20, scale: 4 })
      .notNull(),
    percentileP50: numeric('percentile_p50', { precision: 20, scale: 4 })
      .notNull(),
    percentileP75: numeric('percentile_p75', { precision: 20, scale: 4 })
      .notNull(),
    sampleSize: integer('sample_size').notNull(),
    unit: text('unit'),
    notes: text('notes'),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cohortMetricUnique: uniqueIndex('pca_uniq_cohort_metric').on(
      t.cohortKey,
      t.metricId,
    ),
    cohortMetricIdx: index('idx_pca_cohort_metric').on(
      t.cohortKey,
      t.metricId,
    ),
  }),
);

export type PeerCohortAggregate = typeof peerCohortAggregates.$inferSelect;
export type NewPeerCohortAggregate =
  typeof peerCohortAggregates.$inferInsert;

// ============================================================================
// external_benchmarks
// ============================================================================

export const externalBenchmarks = pgTable(
  'external_benchmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** LBMA | BoT | TRA | NEMC | OSHA | TCRA | TBS | ICA | WORLD_BANK |
     *  IMF | OTHER. */
    source: text('source').notNull(),
    metricId: text('metric_id').notNull(),
    value: numeric('value', { precision: 20, scale: 6 }).notNull(),
    unit: text('unit'),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    latLong: text('lat_long'),
    region: text('region'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    metricAsOfIdx: index('idx_eb_metric_as_of').on(t.metricId, t.asOf),
    sourceMetricIdx: index('idx_eb_source_metric').on(t.source, t.metricId),
  }),
);

export type ExternalBenchmark = typeof externalBenchmarks.$inferSelect;
export type NewExternalBenchmark = typeof externalBenchmarks.$inferInsert;

export const BENCHMARK_SOURCES = [
  'LBMA',
  'BoT',
  'TRA',
  'NEMC',
  'OSHA',
  'TCRA',
  'TBS',
  'ICA',
  'WORLD_BANK',
  'IMF',
  'OTHER',
] as const;
export type BenchmarkSource = (typeof BENCHMARK_SOURCES)[number];
