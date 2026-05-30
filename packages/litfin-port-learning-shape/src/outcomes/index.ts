/**
 * Outcome-as-a-service / outcomes pricing primitives.
 *
 * Ported from LITFIN's outcome-pricing model (loan-approval rate,
 * default rate, repayment-on-time rate priced per outcome). For
 * Borjie the outcomes are mining-domain:
 *
 *   - production_uplift_kg          (grams of gold above baseline)
 *   - shift_safety_incidents_avoided (per-month)
 *   - royalty_filing_on_time         (1.0 or 0.0)
 *   - buyer_price_uplift_minor       (TZS earned above market floor)
 *   - regulator_finding_closed       (1.0 per finding)
 *   - worker_retention_days          (cohort-wide)
 *
 * Pricing model: caller declares a per-outcome unit price; the
 * package computes invoiced value from observed outcomes. Pure
 * functions. Money values use the same integer-minor convention as
 * the rest of Borjie (services/payments-ledger).
 */

export type OutcomeMetric =
  | "production_uplift_g"
  | "shift_safety_incidents_avoided"
  | "royalty_filing_on_time"
  | "buyer_price_uplift_minor"
  | "regulator_finding_closed"
  | "worker_retention_days";

export interface OutcomePriceBook {
  readonly tenantId: string;
  readonly currency: string;
  readonly perUnit: Readonly<Partial<Record<OutcomeMetric, number>>>;
}

export interface OutcomeObservation {
  readonly metric: OutcomeMetric;
  readonly units: number;
  readonly observedAt: string; // ISO date
  readonly evidenceId: string;
}

export interface OutcomeInvoiceLine {
  readonly metric: OutcomeMetric;
  readonly units: number;
  readonly unitPriceMinor: number;
  readonly amountMinor: number;
  readonly evidenceIds: ReadonlyArray<string>;
}

export interface OutcomeInvoice {
  readonly tenantId: string;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lines: ReadonlyArray<OutcomeInvoiceLine>;
  readonly subtotalMinor: number;
}

/**
 * Aggregate observations into invoice lines using the price book.
 * Returns NEW objects. Observations whose metric is not priced are
 * dropped (the caller should validate before invoking if "all
 * observations must price" is the desired contract).
 */
export function priceObservations(args: {
  readonly priceBook: OutcomePriceBook;
  readonly observations: ReadonlyArray<OutcomeObservation>;
  readonly periodStart: string;
  readonly periodEnd: string;
}): OutcomeInvoice {
  const buckets = new Map<
    OutcomeMetric,
    { units: number; evidenceIds: string[] }
  >();
  for (const obs of args.observations) {
    const price = args.priceBook.perUnit[obs.metric];
    if (price === undefined) continue;
    const existing = buckets.get(obs.metric) ?? { units: 0, evidenceIds: [] };
    existing.units += obs.units;
    existing.evidenceIds.push(obs.evidenceId);
    buckets.set(obs.metric, existing);
  }
  const lines: OutcomeInvoiceLine[] = [];
  for (const [metric, agg] of buckets.entries()) {
    const unitPriceMinor = args.priceBook.perUnit[metric] ?? 0;
    const amountMinor = Math.round(agg.units * unitPriceMinor);
    lines.push(
      Object.freeze({
        metric,
        units: agg.units,
        unitPriceMinor,
        amountMinor,
        evidenceIds: Object.freeze(agg.evidenceIds.slice()),
      }) as OutcomeInvoiceLine,
    );
  }
  const subtotalMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  return Object.freeze({
    tenantId: args.priceBook.tenantId,
    currency: args.priceBook.currency,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    lines: Object.freeze(lines),
    subtotalMinor,
  });
}

/**
 * Success-metric snapshot — running totals + month-over-month deltas
 * across the canonical Borjie OaaS metrics.
 */
export interface SuccessMetricSnapshot {
  readonly metric: OutcomeMetric;
  readonly currentMonth: number;
  readonly previousMonth: number;
  readonly trendPercent: number;
}

export function computeTrend(args: {
  readonly currentMonth: number;
  readonly previousMonth: number;
}): number {
  if (args.previousMonth === 0) {
    return args.currentMonth === 0 ? 0 : 100;
  }
  return ((args.currentMonth - args.previousMonth) / args.previousMonth) * 100;
}
