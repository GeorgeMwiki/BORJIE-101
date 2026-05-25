/**
 * Pure scorer for the `ticket_resolved_within_sla` outcome.
 *
 * An event qualifies iff ALL of:
 *   1. `tenantConfirmed === true` (the tenant explicitly said the fix
 *      held — required by the ground-truth contract).
 *   2. `resolutionTimeHours <= slaWindowHours` (resolved INSIDE the
 *      committed window — boundary is inclusive).
 *   3. `reopenedWithinWindow === false` (the same ticket did not
 *      re-open within the clawback window — clawback-aware).
 *
 * Pricing: per_event, capped at `capFractionOfHumanCost * humanCostMinor`
 * if the cap is set. The cap defends against the SKU drifting above
 * the human alternative cost (Bessemer's pricing-discipline rule).
 *
 * Pure: same inputs → same MeteringRecord. No clocks, no random IDs —
 * the caller passes `nowIso` and a precomputed `recordId`. This keeps
 * the scorer testable in isolation and the billing engine in charge
 * of identity + time.
 */
import { getOutcome } from './catalog.js';
import type {
  MeteringRecord,
  PriceUnitPerEvent,
  TicketResolvedEvent,
} from './types.js';

export interface TicketResolvedScorerOptions {
  /** Industry baseline human cost per ticket, minor units. Used only
   *  if the catalog's PriceUnit carries `capFractionOfHumanCost`. */
  readonly humanCostMinor: number;
  /** Stable record ID (UUIDv7 / ULID) supplied by the caller. */
  readonly recordId: string;
  /** Wall clock, supplied by the caller. ISO-8601 string. */
  readonly nowIso: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isPerEvent(unit: unknown): unit is PriceUnitPerEvent {
  return (
    typeof unit === 'object' &&
    unit !== null &&
    (unit as PriceUnitPerEvent).kind === 'per_event'
  );
}

function chooseUnit(
  pricing: ReadonlyArray<unknown>,
): PriceUnitPerEvent | null {
  for (const u of pricing) if (isPerEvent(u)) return u;
  return null;
}

function clawbackCloseIso(nowIso: string, days: number): string {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    throw new Error(`ticket-resolved-metric: invalid nowIso ${nowIso}`);
  }
  return new Date(now + days * DAY_MS).toISOString();
}

export function scoreTicketResolved(
  event: TicketResolvedEvent,
  opts: TicketResolvedScorerOptions,
): MeteringRecord {
  const outcome = getOutcome('ticket_resolved_within_sla');
  const unit = chooseUnit(outcome.pricing);

  const base = {
    recordId: opts.recordId,
    outcomeKind: 'ticket_resolved_within_sla' as const,
    tenantId: event.tenantId,
    propertyId: event.propertyId,
    eventId: event.eventId,
    currency: unit?.currency ?? 'USD',
    scoredAt: opts.nowIso,
    clawbackClosesAt: clawbackCloseIso(opts.nowIso, outcome.clawbackWindowDays),
  };

  // Gate 1: tenant must have confirmed.
  if (!event.tenantConfirmed) {
    return {
      ...base,
      qualified: false,
      reason: 'tenant did not confirm fix',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 2: SLA window. Inclusive boundary — exactly-at-SLA is a pass.
  if (event.resolutionTimeHours > event.slaWindowHours) {
    return {
      ...base,
      qualified: false,
      reason: `resolution ${event.resolutionTimeHours}h exceeded SLA ${event.slaWindowHours}h`,
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Gate 3: clawback — reopened ticket is not a billable resolution.
  if (event.reopenedWithinWindow) {
    return {
      ...base,
      qualified: false,
      reason: 'ticket re-opened within clawback window',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Catalog mis-config: no per_event pricing → fail safe.
  if (unit === null) {
    return {
      ...base,
      qualified: false,
      reason: 'catalog has no per_event pricing for ticket_resolved_within_sla',
      billableAmountMinor: 0,
      priceUnitApplied: null,
    };
  }

  // Apply human-cost cap if configured.
  let billable = unit.amountMinor;
  if (
    typeof unit.capFractionOfHumanCost === 'number' &&
    Number.isFinite(opts.humanCostMinor) &&
    opts.humanCostMinor > 0
  ) {
    const cap = Math.floor(unit.capFractionOfHumanCost * opts.humanCostMinor);
    if (billable > cap) billable = cap;
  }

  return {
    ...base,
    qualified: true,
    reason: `resolved in ${event.resolutionTimeHours}h within SLA ${event.slaWindowHours}h`,
    billableAmountMinor: billable,
    priceUnitApplied: unit,
  };
}
