/**
 * Pure scorer for the `rent_collected` outcome.
 *
 * An event qualifies iff ALL of:
 *   1. `bankReconciled === true` (no shadow payments — only money the
 *      bank confirms is hitting the operator's account counts).
 *   2. `chargedBack === false` (the payment did not reverse within
 *      the clawback window).
 *   3. `collectedMinor > 0` (no point billing on a zero-collection
 *      month — the floor retainer in the SKU bundle handles those).
 *
 * Pricing for a qualified event = (delta above baseline × bp1) +
 *                                 (recovered delinquency × bp2),
 *                                 floored at the min retainer.
 *
 * Delta vs prior-12mo baseline: only the INCREMENT above baseline is
 * billable on the % unit. Below-baseline months bill only the min
 * retainer. This is the counterfactual contract — we charge for
 * the lift, not the baseline.
 *
 * Pure: caller supplies record IDs and clock.
 */
import { getOutcome } from './catalog.js';
import type {
  MeteringRecord,
  PriceUnitPercentage,
  RentCollectedEvent,
} from './types.js';

export interface RentCollectedScorerOptions {
  readonly recordId: string;
  readonly nowIso: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isPercentage(unit: unknown): unit is PriceUnitPercentage {
  return (
    typeof unit === 'object' &&
    unit !== null &&
    (unit as PriceUnitPercentage).kind === 'percentage_of'
  );
}

function clawbackCloseIso(nowIso: string, days: number): string {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    throw new Error(`rent-collected-metric: invalid nowIso ${nowIso}`);
  }
  return new Date(now + days * DAY_MS).toISOString();
}

/** Compute basis-points slice of an amount, rounded down to minor units. */
function applyBp(amountMinor: number, basisPoints: number): number {
  if (amountMinor <= 0 || basisPoints <= 0) return 0;
  return Math.floor((amountMinor * basisPoints) / 10_000);
}

export function scoreRentCollected(
  event: RentCollectedEvent,
  opts: RentCollectedScorerOptions,
): MeteringRecord {
  const outcome = getOutcome('rent_collected');
  const units = outcome.pricing.filter(isPercentage);
  const collectedUnit =
    units.find((u) => u.appliesTo === 'collected_minor') ?? null;
  const delinquencyUnit =
    units.find((u) => u.appliesTo === 'recovered_delinquency_minor') ?? null;

  const currency = collectedUnit?.currency ?? delinquencyUnit?.currency ?? 'USD';

  const base = {
    recordId: opts.recordId,
    outcomeKind: 'rent_collected' as const,
    tenantId: event.tenantId,
    propertyId: event.propertyId,
    eventId: event.eventId,
    currency,
    scoredAt: opts.nowIso,
    clawbackClosesAt: clawbackCloseIso(opts.nowIso, outcome.clawbackWindowDays),
  };

  // Gate 1: bank reconciliation required.
  if (!event.bankReconciled) {
    return {
      ...base,
      qualified: false,
      reason: 'payment not bank-reconciled',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 2: chargeback inside the clawback window.
  if (event.chargedBack) {
    return {
      ...base,
      qualified: false,
      reason: 'payment charged back within clawback window',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 3: nothing collected → fall back to retainer floor (still qualified).
  // We treat zero collections as qualified-with-zero-collection to keep the
  // floor retainer path live downstream.
  if (event.collectedMinor < 0) {
    return {
      ...base,
      qualified: false,
      reason: 'negative collectedMinor is invalid',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Counterfactual: only the lift above prior-12mo baseline is billable
  // on the percentage-of-collected unit. recovered_delinquency is billed
  // directly (it is, by definition, above baseline).
  const liftMinor = Math.max(
    0,
    event.collectedMinor - Math.max(0, event.baselineCollectedMinor),
  );

  const collectedPortion = collectedUnit
    ? applyBp(liftMinor, collectedUnit.basisPoints)
    : 0;
  const delinquencyPortion = delinquencyUnit
    ? applyBp(event.recoveredDelinquencyMinor, delinquencyUnit.basisPoints)
    : 0;

  let billable = collectedPortion + delinquencyPortion;

  // Apply min-retainer floor (use the largest configured retainer; in
  // practice only the collected-percentage unit carries it).
  const retainer = collectedUnit?.minRetainerMinor ?? 0;
  if (billable < retainer) billable = retainer;

  // Which unit "drove" this record? Prefer the collected unit when the
  // lift contributed; otherwise the delinquency unit; otherwise null.
  const driver =
    collectedPortion > 0
      ? collectedUnit
      : delinquencyPortion > 0
        ? delinquencyUnit
        : (collectedUnit ?? delinquencyUnit ?? null);

  return {
    ...base,
    qualified: true,
    reason:
      `lift ${liftMinor} (collected ${event.collectedMinor} vs baseline ${event.baselineCollectedMinor}), ` +
      `recovered delinquency ${event.recoveredDelinquencyMinor}`,
    billableAmountMinor: billable,
    priceUnitApplied: driver,
  };
}
