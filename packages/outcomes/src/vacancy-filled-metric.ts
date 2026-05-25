/**
 * Pure scorer for the `vacancy_filled` outcome.
 *
 * An event qualifies iff ALL of:
 *   1. `leaseExecuted === true` (lease countersigned by both parties).
 *   2. `moveInCompleted === true` (tenant has physically moved in —
 *      the second leg of the ground-truth contract).
 *   3. `cancelledWithinWindow === false` (no cancellation inside the
 *      30-day clawback window).
 *   4. `monthlyRentMinor > 0` (no zero-rent leases — those are
 *      concessions, not commercial fills).
 *
 * Pricing: `fraction_of_monthly_rent * monthlyRentMinor`, rounded
 * down to minor units. Mirrors the traditional letting-agent
 * commission (half a month's rent).
 *
 * Pure: caller supplies record ID + clock.
 */
import { getOutcome } from './catalog.js';
import type {
  MeteringRecord,
  PriceUnitFractionOfRent,
  VacancyFilledEvent,
} from './types.js';

export interface VacancyFilledScorerOptions {
  readonly recordId: string;
  readonly nowIso: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isFractionOfRent(unit: unknown): unit is PriceUnitFractionOfRent {
  return (
    typeof unit === 'object' &&
    unit !== null &&
    (unit as PriceUnitFractionOfRent).kind === 'fraction_of_monthly_rent'
  );
}

function chooseUnit(
  pricing: ReadonlyArray<unknown>,
): PriceUnitFractionOfRent | null {
  for (const u of pricing) if (isFractionOfRent(u)) return u;
  return null;
}

function clawbackCloseIso(nowIso: string, days: number): string {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    throw new Error(`vacancy-filled-metric: invalid nowIso ${nowIso}`);
  }
  return new Date(now + days * DAY_MS).toISOString();
}

export function scoreVacancyFilled(
  event: VacancyFilledEvent,
  opts: VacancyFilledScorerOptions,
): MeteringRecord {
  const outcome = getOutcome('vacancy_filled');
  const unit = chooseUnit(outcome.pricing);

  // The lease's own currency wins over the catalog default — vacancy
  // fills are always denominated in the lease currency, not USD.
  const currency = event.currency || unit?.currency || 'USD';

  const base = {
    recordId: opts.recordId,
    outcomeKind: 'vacancy_filled' as const,
    tenantId: event.tenantId,
    propertyId: event.propertyId,
    eventId: event.eventId,
    currency,
    scoredAt: opts.nowIso,
    clawbackClosesAt: clawbackCloseIso(opts.nowIso, outcome.clawbackWindowDays),
  };

  // Gate 1: lease must be executed.
  if (!event.leaseExecuted) {
    return {
      ...base,
      qualified: false,
      reason: 'lease not executed',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 2: move-in must be completed.
  if (!event.moveInCompleted) {
    return {
      ...base,
      qualified: false,
      reason: 'move-in not completed',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 3: cancellation inside the clawback window kills the bill.
  if (event.cancelledWithinWindow) {
    return {
      ...base,
      qualified: false,
      reason: 'lease cancelled within clawback window',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 4: positive monthly rent.
  if (event.monthlyRentMinor <= 0) {
    return {
      ...base,
      qualified: false,
      reason: 'monthly rent must be positive',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Catalog mis-config.
  if (unit === null) {
    return {
      ...base,
      qualified: false,
      reason: 'catalog has no fraction_of_monthly_rent pricing for vacancy_filled',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  const billable = Math.floor(unit.fraction * event.monthlyRentMinor);

  return {
    ...base,
    qualified: true,
    reason:
      `lease executed + move-in completed for unit ${event.unitId} ` +
      `at ${event.monthlyRentMinor} ${currency}/mo`,
    billableAmountMinor: billable,
    priceUnitApplied: unit,
  };
}
