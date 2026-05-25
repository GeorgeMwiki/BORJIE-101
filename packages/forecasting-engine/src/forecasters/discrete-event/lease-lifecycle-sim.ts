/**
 * LeaseLifecycleSim — discrete-event sim of one lease's lifecycle.
 *
 * Events: lease-signed → rent-paid (recurring) → lease-end → either
 * renew or vacate (sampled from retention curve) → re-list → next
 * tenant. Used by raise-rent and renewal-batch scenarios.
 */

import { mulberry32 } from '../../util/rng.js';

export interface LeaseEvent {
  readonly tMs: number;
  readonly kind:
    | 'lease-signed'
    | 'rent-paid'
    | 'rent-missed'
    | 'lease-end'
    | 'renewed'
    | 'vacated'
    | 're-listed';
  readonly tenantId: string;
  readonly amount?: number;
}

export interface LeaseLifecycleInputs {
  readonly tenantId: string;
  readonly startMs: number;
  readonly horizonMs: number;
  readonly monthlyRent: number;
  readonly paymentReliability: number; // 0..1
  readonly renewalProbability: number; // 0..1, probability at each lease-end
  readonly leaseTermMonths: number;
  readonly daysToFillVacant: number;
  readonly seed: number;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function simulateLeaseLifecycle(
  inputs: LeaseLifecycleInputs,
): ReadonlyArray<LeaseEvent> {
  const rng = mulberry32(inputs.seed);
  const events: LeaseEvent[] = [];
  let t = inputs.startMs;
  const end = inputs.startMs + inputs.horizonMs;

  events.push({ tMs: t, kind: 'lease-signed', tenantId: inputs.tenantId });

  while (t < end) {
    // Lease term in months
    const leaseEnd = t + inputs.leaseTermMonths * MONTH_MS;
    let nextPay = t + MONTH_MS;
    while (nextPay <= leaseEnd && nextPay <= end) {
      if (rng() < inputs.paymentReliability) {
        events.push({
          tMs: nextPay,
          kind: 'rent-paid',
          tenantId: inputs.tenantId,
          amount: inputs.monthlyRent,
        });
      } else {
        events.push({
          tMs: nextPay,
          kind: 'rent-missed',
          tenantId: inputs.tenantId,
          amount: 0,
        });
      }
      nextPay += MONTH_MS;
    }

    if (leaseEnd > end) break;
    events.push({ tMs: leaseEnd, kind: 'lease-end', tenantId: inputs.tenantId });

    if (rng() < inputs.renewalProbability) {
      events.push({ tMs: leaseEnd, kind: 'renewed', tenantId: inputs.tenantId });
      t = leaseEnd;
    } else {
      events.push({ tMs: leaseEnd, kind: 'vacated', tenantId: inputs.tenantId });
      const fillTime = leaseEnd + inputs.daysToFillVacant * DAY_MS;
      if (fillTime <= end) {
        events.push({ tMs: fillTime, kind: 're-listed', tenantId: inputs.tenantId });
      }
      t = fillTime;
    }
  }

  return events;
}
