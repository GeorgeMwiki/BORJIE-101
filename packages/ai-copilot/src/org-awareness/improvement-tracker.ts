/**
 * Improvement Tracker — weekly + monthly snapshots of key metrics per
 * tenant. Enables Mr. Mwikila to answer "how have things changed since
 * we adopted the platform?" with before/after numbers.
 *
 * Metrics tracked:
 *   occupancy_rate                   higher-is-better
 *   arrears_ratio                    lower-is-better
 *   avg_days_to_collect              lower-is-better
 *   avg_maintenance_resolution_hours lower-is-better
 *   renewal_rate                     higher-is-better
 *   avg_vacancy_duration_days        lower-is-better
 *   compliance_breach_count          lower-is-better
 *   avg_lease_drafting_hours         lower-is-better
 *   operator_hours_saved_estimate    higher-is-better
 *
 * Reports diff the current snapshot against a baseline (oldest / flagged
 * is_baseline=true) and return structured deltas with confidence ranges.
 */

import type {
  ImprovementDelta,
  ImprovementMetric,
  ImprovementReport,
  ImprovementSnapshot,
  ImprovementSnapshotInput,
  ImprovementSnapshotStore,
  PeriodKind,
} from './types.js';

export interface ImprovementTrackerDeps {
  readonly store: ImprovementSnapshotStore;
  readonly now?: () => Date;
}

export interface GetImprovementReportOptions {
  readonly metrics?: readonly ImprovementMetric[];
  readonly baseline?: 'borjie_start' | 'oldest';
  readonly baselineSnapshotId?: string;
}

export const HIGHER_IS_BETTER: ReadonlyArray<ImprovementMetric> = [
  'occupancy_rate',
  'renewal_rate',
  'operator_hours_saved_estimate',
];

export const ALL_METRICS: ReadonlyArray<ImprovementMetric> = [
  'occupancy_rate',
  'arrears_ratio',
  'avg_days_to_collect',
  'avg_maintenance_resolution_hours',
  'renewal_rate',
  'avg_vacancy_duration_days',
  'compliance_breach_count',
  'avg_lease_drafting_hours',
  'operator_hours_saved_estimate',
];

export class ImprovementTracker {
  private readonly deps: ImprovementTrackerDeps;

  constructor(deps: ImprovementTrackerDeps) {
    this.deps = deps;
  }

  async recordSnapshot(
    input: ImprovementSnapshotInput,
  ): Promise<ImprovementSnapshot> {
    if (!input.tenantId) {
      throw new Error('recordSnapshot: tenantId required');
    }
    if (!Number.isFinite(input.value)) {
      throw new Error('recordSnapshot: value must be a finite number');
    }
    return this.deps.store.upsert(input);
  }

  async getImprovementReport(
    tenantId: string,
    options: GetImprovementReportOptions = {},
  ): Promise<ImprovementReport> {
    const metrics = options.metrics ?? ALL_METRICS;
    const deltas: ImprovementDelta[] = [];
    for (const metric of metrics) {
      const baseline = await this.deps.store.getBaseline(
        tenantId,
        metric,
      );
      const latest = await this.deps.store.getLatest(tenantId, metric);
      if (!baseline || !latest) continue;
      if (baseline.id === latest.id) continue;
      deltas.push(toDelta(metric, baseline, latest));
    }
    const generatedAt = (
      this.deps.now?.() ?? new Date()
    ).toISOString();
    return {
      tenantId,
      baselineKind:
        options.baseline === 'borjie_start'
          ? 'borjie_start'
          : options.baseline === 'oldest'
            ? 'explicit'
            : deltas.length > 0
              ? 'borjie_start'
              : 'none',
      generatedAt,
      deltas,
      summary: buildSummary(deltas),
    };
  }

  /**
   * Convenience helper for the manual snapshot endpoint. Computes period
   * bounds from a period kind and a reference `now`.
   */
  buildPeriod(
    now: Date,
    periodKind: PeriodKind,
  ): { periodStart: Date; periodEnd: Date } {
    if (periodKind === 'weekly') {
      const day = now.getUTCDay();
      const start = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - day,
        ),
      );
      const end = new Date(
        start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1,
      );
      return { periodStart: start, periodEnd: end };
    }
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
    );
    return { periodStart: start, periodEnd: end };
  }
}

export function createImprovementTracker(
  deps: ImprovementTrackerDeps,
): ImprovementTracker {
  return new ImprovementTracker(deps);
}

function toDelta(
  metric: ImprovementMetric,
  baseline: ImprovementSnapshot,
  latest: ImprovementSnapshot,
): ImprovementDelta {
  const absoluteChange = latest.value - baseline.value;
  const percentChange =
    baseline.value === 0
      ? 0
      : (absoluteChange / Math.abs(baseline.value)) * 100;
  const direction: ImprovementDelta['direction'] =
    Math.abs(percentChange) < 0.01
      ? 'flat'
      : absoluteChange > 0
        ? 'up'
        : 'down';
  const higherIsBetter = HIGHER_IS_BETTER.includes(metric);
  const isBetter =
    direction === 'flat'
      ? true
      : higherIsBetter
        ? direction === 'up'
        : direction === 'down';
  return {
    metric,
    baselineValue: baseline.value,
    currentValue: latest.value,
    absoluteChange,
    percentChange,
    direction,
    isBetter,
    confidenceLow: latest.confidenceLow,
    confidenceHigh: latest.confidenceHigh,
    baselinePeriodStart: baseline.periodStart.toISOString(),
    currentPeriodStart: latest.periodStart.toISOString(),
  };
}

function buildSummary(deltas: readonly ImprovementDelta[]): string {
  if (deltas.length === 0) {
    return 'Not enough snapshot history yet to produce an improvement report.';
  }
  const betterCount = deltas.filter((d) => d.isBetter).length;
  const worseCount = deltas.length - betterCount;
  const topGain = [...deltas]
    .filter((d) => d.isBetter && d.direction !== 'flat')
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .shift();
  const topPain = [...deltas]
    .filter((d) => !d.isBetter && d.direction !== 'flat')
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .shift();
  const parts: string[] = [
    `${betterCount} of ${deltas.length} tracked metrics improved since baseline`,
  ];
  if (topGain) {
    parts.push(
      `biggest gain: ${topGain.metric} moved ${topGain.percentChange.toFixed(1)}% (${topGain.direction})`,
    );
  }
  if (topPain) {
    parts.push(
      `attention needed: ${topPain.metric} moved ${topPain.percentChange.toFixed(1)}% (${topPain.direction})`,
    );
  }
  if (worseCount === 0) parts.push('no regressions detected');
  return parts.join('; ') + '.';
}
