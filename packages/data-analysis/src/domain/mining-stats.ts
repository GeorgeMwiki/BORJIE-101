/**
 * Mining-domain wrappers — the ONLY place mining-specific vocabulary
 * appears in the package. The rest of @borjie/data-analysis is
 * domain-neutral.
 *
 * These wrappers compose the neutral primitives into the four call
 * shapes Mr. Mwikila's voice-agent uses most often:
 *
 *   1. sitePerformanceStats(throughputByDay)
 *      → descriptive summary + bootstrap CI on the mean
 *
 *   2. royaltyRateAnalysis(beforeRates, afterRates)
 *      → Welch t-test + Cohen's d + percent change of mean
 *
 *   3. safetyIncidentCorrelation(incidents, drivers, categoricalDrivers)
 *      → Pearson, Spearman + chi-square on the categorical driver
 *
 *   4. buyerCohortAnalysis(features, k)
 *      → k-means cohort assignment + silhouette score
 */

import type { DescriptiveStats, HypothesisTestResult } from '../types.js';
import { describe } from '../descriptive/summary.js';
import { mean } from '../descriptive/mean.js';
import { stddev } from '../descriptive/stddev.js';
import { bootstrap, type BootstrapResult } from '../sample/bootstrap.js';
import { welchTTest } from '../inferential/welch-t.js';
import { chiSquareIndependence } from '../inferential/chi-square.js';
import { pearson } from '../correlation/pearson.js';
import { spearman } from '../correlation/spearman.js';
import { kmeans, silhouetteScore } from '../cluster/kmeans.js';
import type { ClusterAssignment } from '../types.js';
import { defaultLogger, type Logger } from '../logger.js';

export interface SitePerformance {
  readonly siteId: string;
  readonly summary: DescriptiveStats;
  readonly meanCi95: { readonly low: number; readonly high: number };
  readonly nDays: number;
}

/**
 * Per-site performance: descriptive summary + 95 % bootstrap CI on
 * the mean throughput. The CI is the part Mr. Mwikila actually trusts
 * — a single mean without an interval is misleading on small days.
 */
export function sitePerformanceStats(
  siteId: string,
  throughputByDay: ReadonlyArray<number>,
  opts: { readonly seed?: number; readonly logger?: Logger } = {},
): SitePerformance {
  const log = opts.logger ?? defaultLogger;
  const start = Date.now();
  const summary = describe(throughputByDay);
  const boot: BootstrapResult = bootstrap(
    throughputByDay,
    mean,
    2000,
    0.05,
    opts.seed,
  );
  const result: SitePerformance = {
    siteId,
    summary,
    meanCi95: { low: boot.low, high: boot.high },
    nDays: throughputByDay.length,
  };
  log.info('sitePerformanceStats.complete', {
    siteId,
    nDays: throughputByDay.length,
    durationMs: Date.now() - start,
  });
  return result;
}

export interface RoyaltyAnalysis {
  readonly meanBefore: number;
  readonly meanAfter: number;
  readonly percentChange: number;
  readonly cohenD: number;
  readonly test: HypothesisTestResult;
}

/**
 * Royalty-rate change analysis — Welch t-test (Mr. Mwikila's "before"
 * and "after" populations rarely have equal variance, so equal-variance
 * t is wrong), plus Cohen's d to communicate effect size in addition
 * to statistical significance.
 *
 * Cohen's d = (x̄1 − x̄2) / s_pooled.
 */
export function royaltyRateAnalysis(
  before: ReadonlyArray<number>,
  after: ReadonlyArray<number>,
  opts: { readonly alpha?: number; readonly logger?: Logger } = {},
): RoyaltyAnalysis {
  const log = opts.logger ?? defaultLogger;
  const start = Date.now();
  const m1 = mean(before);
  const m2 = mean(after);
  const s1 = stddev(before);
  const s2 = stddev(after);
  const n1 = before.length;
  const n2 = after.length;
  const pooled = Math.sqrt(
    ((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2),
  );
  const cohenD = pooled === 0 ? 0 : (m2 - m1) / pooled;
  const percentChange = m1 === 0 ? Number.POSITIVE_INFINITY : (m2 - m1) / m1;
  const test = welchTTest(before, after, 'two-sided', opts.alpha ?? 0.05);
  log.info('royaltyRateAnalysis.complete', {
    nBefore: n1,
    nAfter: n2,
    durationMs: Date.now() - start,
  });
  return {
    meanBefore: m1,
    meanAfter: m2,
    percentChange,
    cohenD,
    test,
  };
}

export interface SafetyCorrelation {
  readonly pearsonR: number;
  readonly spearmanR: number;
  readonly chiSquare?: HypothesisTestResult;
}

/**
 * Correlate a numeric safety-incidents vector with a numeric driver
 * (e.g. weather index, hours worked) and optionally test independence
 * against a categorical co-occurrence matrix (e.g. shift × incident-bucket).
 */
export function safetyIncidentCorrelation(
  incidents: ReadonlyArray<number>,
  numericDriver: ReadonlyArray<number>,
  categoricalContingency?: ReadonlyArray<ReadonlyArray<number>>,
  opts: { readonly logger?: Logger } = {},
): SafetyCorrelation {
  const log = opts.logger ?? defaultLogger;
  const start = Date.now();
  const pearsonR = pearson(incidents, numericDriver);
  const spearmanR = spearman(incidents, numericDriver);
  const chiSquare = categoricalContingency
    ? chiSquareIndependence(categoricalContingency)
    : undefined;
  log.info('safetyIncidentCorrelation.complete', {
    n: incidents.length,
    hasCategorical: categoricalContingency !== undefined,
    durationMs: Date.now() - start,
  });
  if (chiSquare === undefined) {
    return { pearsonR, spearmanR };
  }
  return { pearsonR, spearmanR, chiSquare };
}

export interface BuyerCohort {
  readonly assignment: ClusterAssignment;
  readonly silhouette: number;
}

/**
 * Buyer-cohort discovery — k-means on a normalised feature matrix
 * (e.g. [purchase frequency, average grade, average tonnage]) plus
 * silhouette score so Mr. Mwikila can tell whether the k he picked
 * is structurally reasonable.
 */
export function buyerCohortAnalysis(
  features: ReadonlyArray<ReadonlyArray<number>>,
  k: number,
  opts: { readonly seed?: number; readonly logger?: Logger } = {},
): BuyerCohort {
  const log = opts.logger ?? defaultLogger;
  const start = Date.now();
  const assignment = opts.seed === undefined
    ? kmeans(features, k)
    : kmeans(features, k, { seed: opts.seed });
  const silhouette = silhouetteScore(features, assignment.labels);
  log.info('buyerCohortAnalysis.complete', {
    n: features.length,
    k,
    silhouette,
    durationMs: Date.now() - start,
  });
  return { assignment, silhouette };
}
