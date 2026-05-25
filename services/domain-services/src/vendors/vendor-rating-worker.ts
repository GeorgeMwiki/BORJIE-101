/**
 * Vendor Rating Worker — SCAFFOLDED 9
 *
 * Nightly recompute of each vendor's aggregated ratings and performance
 * metrics based on a 180-day rolling window of completed work orders.
 *
 * Architecture:
 *   - Pure computation functions below are deterministic and unit-tested.
 *   - Side effects (listing vendors, writing back ratings) live on the
 *     repository port so the worker is trivial to mock.
 *
 * The worker is scheduled by whatever runner the deployment uses
 * (node-cron / Temporal / plain setInterval) — this module just exposes
 * `runVendorRatingRecompute()` which runs the full pass for a tenant
 * and returns a summary of updated vendors.
 */

import type {
  VendorProfileDto,
  VendorRatingsDto,
  VendorMetricsDto,
  VendorRepositoryPort,
  VendorWorkOrderOutcomeDto,
} from './vendor-repository.interface.js';

export const RATING_WINDOW_DAYS = 180;

// ---------------------------------------------------------------------------
// Pure aggregation — exported for unit tests
// ---------------------------------------------------------------------------

export interface AggregatedRatings {
  ratings: VendorRatingsDto;
  metrics: VendorMetricsDto;
  sampleSize: number;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((acc, v) => acc + v, 0);
  return Math.round((total / values.length) * 100) / 100;
}

function asPct(n: number, d: number): number {
  if (d === 0) return 0;
  return Math.round((n / d) * 100 * 100) / 100;
}

export function aggregateVendorOutcomes(
  outcomes: VendorWorkOrderOutcomeDto[]
): AggregatedRatings {
  const sampleSize = outcomes.length;
  if (sampleSize === 0) {
    return {
      ratings: {
        overall: 0,
        quality: 0,
        reliability: 0,
        communication: 0,
        value: 0,
      },
      metrics: {
        completedJobs: 0,
        averageResponseTimeHours: 0,
        onTimeCompletionPct: 0,
        repeatCallRatePct: 0,
      },
      sampleSize: 0,
    };
  }

  const qualityRatings = outcomes
    .map((o) => o.ratingQuality)
    .filter((r): r is number => typeof r === 'number');
  const overallRatings = outcomes
    .map((o) => o.ratingOverall)
    .filter((r): r is number => typeof r === 'number');
  const communicationRatings = outcomes
    .map((o) => o.ratingCommunication)
    .filter((r): r is number => typeof r === 'number');

  // Reliability: fraction of completed jobs that finished on or before
  // their scheduled time (when scheduled).
  const scheduledOutcomes = outcomes.filter((o) => o.scheduledAt !== null);
  const onTimeCount = scheduledOutcomes.filter((o) => {
    if (!o.scheduledAt || !o.actualCompletionAt) return false;
    return o.actualCompletionAt.getTime() <= o.scheduledAt.getTime();
  }).length;
  const onTimeCompletionPct = asPct(onTimeCount, scheduledOutcomes.length);

  // Value: inverse of cost overrun — cap at 5.
  const costOutcomes = outcomes.filter(
    (o) =>
      typeof o.costActual === 'number' &&
      typeof o.costEstimated === 'number' &&
      o.costEstimated > 0
  );
  const valueScores = costOutcomes.map((o) => {
    const overrun = (o.costActual! - o.costEstimated!) / o.costEstimated!;
    if (overrun <= 0) return 5;
    if (overrun >= 1) return 1;
    return Math.round((5 - overrun * 4) * 100) / 100;
  });

  // Response time: hours between (say) scheduled and first response.
  const responseHours = outcomes
    .map((o) => o.firstResponseMinutes)
    .filter((m): m is number => typeof m === 'number' && m >= 0)
    .map((m) => m / 60);

  // Repeat call rate: % of outcomes that were reopened.
  const reopenCount = outcomes.filter((o) => o.wasReopened).length;
  const repeatCallRatePct = asPct(reopenCount, sampleSize);

  const ratings: VendorRatingsDto = {
    overall: average(overallRatings),
    quality: average(qualityRatings),
    reliability: Math.round((onTimeCompletionPct / 20) * 100) / 100, // 0..5 scale
    communication: average(communicationRatings),
    value: average(valueScores),
  };

  const metrics: VendorMetricsDto = {
    completedJobs: sampleSize,
    averageResponseTimeHours: average(responseHours),
    onTimeCompletionPct,
    repeatCallRatePct,
  };

  return { ratings, metrics, sampleSize };
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export interface VendorRatingRecomputeSummary {
  tenantId: string;
  windowStart: Date;
  windowEnd: Date;
  vendorsInspected: number;
  vendorsUpdated: number;
  vendorsSkippedNoData: number;
  errors: Array<{ vendorId: string; error: string }>;
}

export interface RunOptions {
  tenantId: string;
  /** Override the "now" used as window end — primarily for tests. */
  now?: Date;
  /** Override the window size (default = 180 days). */
  windowDays?: number;
  /** Only recompute vendors in this id list — primarily for backfills. */
  vendorIds?: string[];
}

export async function runVendorRatingRecompute(
  repo: VendorRepositoryPort,
  options: RunOptions
): Promise<VendorRatingRecomputeSummary> {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? RATING_WINDOW_DAYS;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const summary: VendorRatingRecomputeSummary = {
    tenantId: options.tenantId,
    windowStart,
    windowEnd: now,
    vendorsInspected: 0,
    vendorsUpdated: 0,
    vendorsSkippedNoData: 0,
    errors: [],
  };

  const allVendors = await repo.findAllActive(options.tenantId);
  const scoped = options.vendorIds
    ? allVendors.filter((v) => options.vendorIds!.includes(v.id))
    : allVendors;

  for (const vendor of scoped) {
    summary.vendorsInspected += 1;
    try {
      const outcomes = await repo.listRecentOutcomes({
        tenantId: options.tenantId,
        vendorId: vendor.id,
        windowStart,
        windowEnd: now,
      });

      if (outcomes.length === 0) {
        summary.vendorsSkippedNoData += 1;
        continue;
      }

      const aggregated = aggregateVendorOutcomes(outcomes);
      await repo.updateRatingAggregate({
        vendorId: vendor.id,
        tenantId: options.tenantId,
        ratings: aggregated.ratings,
        metrics: aggregated.metrics,
        sampleSize: aggregated.sampleSize,
        computedAt: now,
      });
      summary.vendorsUpdated += 1;
    } catch (err) {
      summary.errors.push({
        vendorId: vendor.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

// Helper used by tests — exposed for verifying monotonicity.
export { type VendorProfileDto };
