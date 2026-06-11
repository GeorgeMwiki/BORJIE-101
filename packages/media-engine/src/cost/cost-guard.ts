/**
 * Cost guard — a pre-spend budget ceiling, NOT a ledger posting.
 *
 * Before a provider is invoked the engine asks the guard whether the
 * estimated cost fits inside the per-tenant remaining budget. The guard
 * reserves the estimate; on success it commits, on failure/timeout it
 * releases. This caps spend deterministically and never touches
 * `LedgerService.post()` (money-path hard rail — see SOTA spec §5).
 *
 * The guard is in-memory + injectable: the host can swap a durable
 * implementation. Reservations are immutable snapshots.
 *
 * @module @borjie/media-engine/cost/cost-guard
 */

import { MediaEngineError } from '../types.js';

export interface CostReservation {
  readonly id: string;
  readonly amountCents: number;
}

export interface CostGuard {
  /** Remaining budget in cents. */
  readonly remainingCents: number;
  /**
   * Reserve `amountCents`. Throws `budget_exceeded` if it would breach
   * the ceiling. Returns an immutable reservation handle.
   */
  reserve(amountCents: number, reservationId: string): CostReservation;
  /** Commit a reservation (spend is final). */
  commit(reservation: CostReservation): void;
  /** Release a reservation (refund the hold). */
  release(reservation: CostReservation): void;
}

/**
 * Build an in-memory cost guard seeded with the per-tenant budget. All
 * state transitions return-or-throw; the `remainingCents` getter always
 * reflects committed + outstanding reservations.
 */
export function createCostGuard(budgetCents: number): CostGuard {
  if (!Number.isInteger(budgetCents) || budgetCents < 0) {
    throw new MediaEngineError(
      'invalid_request',
      `budgetCents must be a non-negative integer, got ${budgetCents}`,
    );
  }
  let committed = 0;
  const outstanding = new Map<string, number>();

  const sumOutstanding = (): number => {
    let total = 0;
    for (const amount of outstanding.values()) total += amount;
    return total;
  };

  const guard: CostGuard = {
    get remainingCents(): number {
      return budgetCents - committed - sumOutstanding();
    },
    reserve(amountCents: number, reservationId: string): CostReservation {
      if (!Number.isInteger(amountCents) || amountCents < 0) {
        throw new MediaEngineError(
          'invalid_request',
          `reservation amount must be a non-negative integer, got ${amountCents}`,
        );
      }
      if (amountCents > guard.remainingCents) {
        throw new MediaEngineError(
          'budget_exceeded',
          `media spend ${amountCents}c exceeds remaining budget ${guard.remainingCents}c`,
        );
      }
      outstanding.set(reservationId, amountCents);
      return Object.freeze({ id: reservationId, amountCents });
    },
    commit(reservation: CostReservation): void {
      const held = outstanding.get(reservation.id);
      if (held === undefined) return;
      outstanding.delete(reservation.id);
      committed += held;
    },
    release(reservation: CostReservation): void {
      outstanding.delete(reservation.id);
    },
  };
  return guard;
}
