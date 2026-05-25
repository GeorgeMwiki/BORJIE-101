/**
 * Counterfactual baseline — prior-12mo math.
 *
 * For outcomes priced on a delta (today: `rent_collected`) we need a
 * defensible "what would have happened anyway" number. The simplest,
 * customer-explainable baseline is:
 *
 *   mean(monthly collected, last N months) ± stddev
 *
 * with a minimum-sample guard so we don't bill a 3-property landlord
 * on a 1-month window. Below the minimum, `trustworthy=false` and the
 * billing engine falls back to the floor retainer rather than computing
 * a delta.
 *
 * Pure: deterministic over its sample. No I/O, no clocks.
 *
 * Statistical choices:
 *   - Mean (not median) — landlords reason about averages; the SKU is
 *     "% of incremental collected above your average".
 *   - Population stddev (not sample) — we treat the historical window
 *     as the population for the property; we're not generalising.
 *   - Months with zero collections COUNT in the baseline — a zero
 *     month is a real signal of property-state risk.
 */
import type {
  BaselineMonthSample,
  CounterfactualBaseline,
} from './types.js';

export interface BaselineOptions {
  /** Default 12 — the contract uses prior-12mo. */
  readonly minMonths?: number;
  /** Maximum sample size; older entries dropped. Default 12. */
  readonly windowMonths?: number;
}

const DEFAULT_MIN = 12;
const DEFAULT_WINDOW = 12;

/** Sort samples by month ascending (YYYY-MM lex sort works). */
function sortByMonth(
  samples: ReadonlyArray<BaselineMonthSample>,
): ReadonlyArray<BaselineMonthSample> {
  return [...samples].sort((a, b) => a.month.localeCompare(b.month));
}

/** Take the most-recent N months. Empty samples → empty output. */
function tail<T>(arr: ReadonlyArray<T>, n: number): ReadonlyArray<T> {
  if (n <= 0 || arr.length === 0) return [];
  return arr.slice(Math.max(0, arr.length - n));
}

/** Population stddev. Returns 0 for a one-element sample. */
function populationStddev(values: ReadonlyArray<number>, mean: number): number {
  if (values.length === 0) return 0;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
}

/**
 * Compute the per-property prior-12mo baseline.
 *
 * @throws if `samples` contain duplicate months (caller error — the
 *   billing engine should dedupe upstream; refusing here surfaces the
 *   bug instead of silently double-counting).
 */
export function computeBaseline(
  propertyId: string,
  samples: ReadonlyArray<BaselineMonthSample>,
  opts: BaselineOptions = {},
): CounterfactualBaseline {
  if (!propertyId) {
    throw new Error('counterfactual-baseline: propertyId is required');
  }
  const minMonths = opts.minMonths ?? DEFAULT_MIN;
  const windowMonths = opts.windowMonths ?? DEFAULT_WINDOW;
  if (minMonths <= 0) {
    throw new Error('counterfactual-baseline: minMonths must be > 0');
  }
  if (windowMonths <= 0) {
    throw new Error('counterfactual-baseline: windowMonths must be > 0');
  }

  // Validate: no negatives, no duplicate months.
  const seen = new Set<string>();
  for (const s of samples) {
    if (s.collectedMinor < 0) {
      throw new Error(
        `counterfactual-baseline: negative collectedMinor for ${s.month}`,
      );
    }
    if (seen.has(s.month)) {
      throw new Error(`counterfactual-baseline: duplicate month ${s.month}`);
    }
    seen.add(s.month);
  }

  // Sort, take the trailing window.
  const sorted = sortByMonth(samples);
  const windowed = tail(sorted, windowMonths);

  const months = windowed.length;
  if (months === 0) {
    return {
      propertyId,
      meanMonthlyCollectedMinor: 0,
      stddevMonthlyCollectedMinor: 0,
      months: 0,
      trustworthy: false,
    };
  }

  let total = 0;
  for (const s of windowed) total += s.collectedMinor;
  const mean = total / months;
  // Round mean down to minor units — we cannot bill on fractional cents.
  const meanMinor = Math.floor(mean);
  const stddevMinor = Math.floor(
    populationStddev(
      windowed.map((s) => s.collectedMinor),
      mean,
    ),
  );

  return {
    propertyId,
    meanMonthlyCollectedMinor: meanMinor,
    stddevMonthlyCollectedMinor: stddevMinor,
    months,
    trustworthy: months >= minMonths,
  };
}

/**
 * Delta above baseline. Negative deltas clamp to 0 — we never charge a
 * percentage of a negative number, and we never credit the customer
 * for under-performance via this primitive (that's a credit-note
 * decision the billing engine owns).
 */
export function deltaAboveBaseline(
  actualCollectedMinor: number,
  baseline: CounterfactualBaseline,
): number {
  if (actualCollectedMinor <= 0) return 0;
  if (!baseline.trustworthy) {
    // Without a trustworthy baseline the "delta" is undefined; the
    // billing engine should fall back to the floor retainer.
    return 0;
  }
  const delta = actualCollectedMinor - baseline.meanMonthlyCollectedMinor;
  return delta > 0 ? delta : 0;
}
