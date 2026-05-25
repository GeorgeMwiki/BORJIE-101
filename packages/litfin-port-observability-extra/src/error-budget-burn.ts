/**
 * Error-budget-burn calculator — per-SLO burn-rate alerts.
 *
 * LITFIN ref: src/core/telemetry/slo-burn.ts — computes Google SRE
 * "multi-window, multi-burn-rate" alert thresholds for any SLO with a
 * configured target.
 *
 * The default alert windows (1h / 6h) match the Google SRE workbook
 * recommendation for a 30-day rolling SLO window.
 */

export interface SloDefinition {
  readonly slobId: string;
  /** Target success ratio, e.g. 0.999 for "3 nines". */
  readonly targetRatio: number;
  /** Rolling window in days the SLO is measured over (typically 30). */
  readonly windowDays: number;
}

export interface BurnRateThresholds {
  /** "page now" — short-window very-fast burn. */
  readonly pageThreshold: number;
  /** "ticket me later" — long-window slow burn. */
  readonly ticketThreshold: number;
}

/** SRE workbook recommended thresholds for 30-day SLOs. */
export const SRE_30D_THRESHOLDS: BurnRateThresholds = {
  pageThreshold: 14.4, // 1h window: 2% budget burn in 1h
  ticketThreshold: 6, // 6h window: 5% budget burn in 6h
};

export interface BurnSample {
  readonly totalRequests: number;
  readonly badRequests: number;
}

export const errorRatio = (sample: BurnSample): number =>
  sample.totalRequests === 0 ? 0 : sample.badRequests / sample.totalRequests;

/**
 * Burn rate = current error rate / (1 - SLO target).
 * A burn rate of 1 = exactly meeting the budget.
 * A burn rate of 10 = burning 10x faster than the budget allows.
 */
export const burnRate = (sample: BurnSample, slo: SloDefinition): number => {
  const allowedFailureRatio = 1 - slo.targetRatio;
  if (allowedFailureRatio === 0) return Number.POSITIVE_INFINITY;
  return errorRatio(sample) / allowedFailureRatio;
};

export type BurnAlertVerdict = 'ok' | 'ticket' | 'page';

export const burnVerdict = (
  shortBurn: number,
  longBurn: number,
  thresholds: BurnRateThresholds = SRE_30D_THRESHOLDS,
): BurnAlertVerdict => {
  if (shortBurn >= thresholds.pageThreshold && longBurn >= thresholds.pageThreshold) {
    return 'page';
  }
  if (shortBurn >= thresholds.ticketThreshold && longBurn >= thresholds.ticketThreshold) {
    return 'ticket';
  }
  return 'ok';
};

/**
 * Remaining error budget — how many more bad requests can still happen
 * within the window before the SLO is breached.
 */
export const remainingBudget = (
  windowSample: BurnSample,
  slo: SloDefinition,
): number => {
  const allowed = Math.floor(windowSample.totalRequests * (1 - slo.targetRatio));
  return Math.max(0, allowed - windowSample.badRequests);
};
