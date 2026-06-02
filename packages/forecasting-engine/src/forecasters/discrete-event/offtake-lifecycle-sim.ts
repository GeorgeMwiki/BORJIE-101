/**
 * OfftakeLifecycleSim — discrete-event sim of one offtake's lifecycle.
 *
 * Events: offtake-signed → royalty-paid (recurring) → offtake-end →
 * either renew or walk-away (sampled from retention curve) →
 * re-contract → next counterparty. Used by raise-royalty and
 * renewal-batch scenarios.
 *
 * NOTE: file renamed from `lease-lifecycle-sim.ts`; deprecated
 * `*Lease*` aliases are retained for any in-flight importer.
 */

import { mulberry32 } from '../../util/rng.js';

export interface OfftakeEvent {
  readonly tMs: number;
  readonly kind:
    | 'offtake-signed'
    | 'royalty-paid'
    | 'royalty-missed'
    | 'offtake-end'
    | 'renewed'
    | 'walked-away'
    | 're-listed';
  readonly counterpartyId: string;
  readonly amount?: number;
}

/** @deprecated Use {@link OfftakeEvent}. */
export type LeaseEvent = OfftakeEvent;

export interface OfftakeLifecycleInputs {
  readonly counterpartyId: string;
  readonly startMs: number;
  readonly horizonMs: number;
  readonly monthlyRoyalty: number;
  readonly paymentReliability: number; // 0..1
  readonly renewalProbability: number; // 0..1, probability at each offtake-end
  readonly offtakeTermMonths: number;
  readonly daysToReContract: number;
  readonly seed: number;
}

/** @deprecated Use {@link OfftakeLifecycleInputs}. */
export type LeaseLifecycleInputs = OfftakeLifecycleInputs;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function simulateOfftakeLifecycle(
  inputs: OfftakeLifecycleInputs,
): ReadonlyArray<OfftakeEvent> {
  const rng = mulberry32(inputs.seed);
  const events: OfftakeEvent[] = [];
  let t = inputs.startMs;
  const end = inputs.startMs + inputs.horizonMs;

  events.push({ tMs: t, kind: 'offtake-signed', counterpartyId: inputs.counterpartyId });

  while (t < end) {
    // Offtake term in months
    const offtakeEnd = t + inputs.offtakeTermMonths * MONTH_MS;
    let nextPay = t + MONTH_MS;
    while (nextPay <= offtakeEnd && nextPay <= end) {
      if (rng() < inputs.paymentReliability) {
        events.push({
          tMs: nextPay,
          kind: 'royalty-paid',
          counterpartyId: inputs.counterpartyId,
          amount: inputs.monthlyRoyalty,
        });
      } else {
        events.push({
          tMs: nextPay,
          kind: 'royalty-missed',
          counterpartyId: inputs.counterpartyId,
          amount: 0,
        });
      }
      nextPay += MONTH_MS;
    }

    if (offtakeEnd > end) break;
    events.push({ tMs: offtakeEnd, kind: 'offtake-end', counterpartyId: inputs.counterpartyId });

    if (rng() < inputs.renewalProbability) {
      events.push({ tMs: offtakeEnd, kind: 'renewed', counterpartyId: inputs.counterpartyId });
      t = offtakeEnd;
    } else {
      events.push({ tMs: offtakeEnd, kind: 'walked-away', counterpartyId: inputs.counterpartyId });
      const fillTime = offtakeEnd + inputs.daysToReContract * DAY_MS;
      if (fillTime <= end) {
        events.push({ tMs: fillTime, kind: 're-listed', counterpartyId: inputs.counterpartyId });
      }
      t = fillTime;
    }
  }

  return events;
}

/** @deprecated Use {@link simulateOfftakeLifecycle}. */
export const simulateLeaseLifecycle = simulateOfftakeLifecycle;
