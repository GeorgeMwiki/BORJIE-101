/**
 * Pure translator: worker store quantity-movement → inventory-management verb.
 *
 * The legacy `/api/v1/warehouse/items/:id/movements` POST carries the worker
 * store contract `{ movementType: 'issue' | 'return' | 'adjust', quantityDelta,
 * reason? }`. This module maps that contract onto exactly one of the REAL
 * `@borjie/inventory-management` verbs (`issueStock` / `receiveStock` /
 * `adjustStock`), keeping the route handler tiny and the mapping unit-testable
 * in isolation (no DB, no Hono context).
 *
 *   issue  → issueStock   (stock leaves the store; |delta| as a positive qty)
 *   return → receiveStock (stock returns to the store; |delta| as a positive qty)
 *   adjust → adjustStock  (signed correction; delta passed through as-is)
 *
 * `:id` is the SKU id. The store location is a single default key so the
 * append-only on-hand replay nets issues against returns at the same location.
 *
 * All inputs are assumed already zod-validated by the route (movementType is a
 * closed enum, quantityDelta is an integer). The translator is total over that
 * domain and returns a discriminated `PlannedMovement` the handler dispatches.
 */

export type WorkerMovementType = 'issue' | 'return' | 'adjust';

export interface WorkerQuantityMovement {
  readonly movementType: WorkerMovementType;
  readonly quantityDelta: number;
  readonly reason?: string;
}

export interface MovementContext {
  readonly skuId: string;
  readonly locationId: string;
  readonly actorUserId?: string;
}

export type PlannedMovement =
  | {
      readonly verb: 'receipt';
      readonly args: {
        readonly skuId: string;
        readonly locationId: string;
        readonly quantity: number;
        readonly reference?: string;
        readonly actorUserId?: string;
      };
    }
  | {
      readonly verb: 'issue';
      readonly args: {
        readonly skuId: string;
        readonly fromLocationId: string;
        readonly quantity: number;
        readonly reference?: string;
        readonly actorUserId?: string;
      };
    }
  | {
      readonly verb: 'adjust';
      readonly args: {
        readonly skuId: string;
        readonly locationId: string;
        readonly delta: number;
        readonly reason?: string;
        readonly actorUserId?: string;
      };
    };

/** A movement whose net effect is zero is meaningless — reject it upstream. */
export class EmptyMovementError extends Error {
  constructor() {
    super('quantityDelta must be non-zero');
    this.name = 'EmptyMovementError';
  }
}

/**
 * Plan a worker quantity movement against the inventory engine. Throws
 * `EmptyMovementError` when the net quantity is zero (nothing to record).
 * For `issue` / `return` the magnitude is taken so the caller can never
 * accidentally invert the sign; `adjust` preserves the signed delta.
 */
export function planQuantityMovement(
  movement: WorkerQuantityMovement,
  ctx: MovementContext,
): PlannedMovement {
  const magnitude = Math.abs(movement.quantityDelta);
  if (magnitude === 0) {
    throw new EmptyMovementError();
  }
  const reference = movement.reason;
  const withActor = ctx.actorUserId ? { actorUserId: ctx.actorUserId } : {};
  const withReference = reference ? { reference } : {};

  if (movement.movementType === 'issue') {
    return {
      verb: 'issue',
      args: {
        skuId: ctx.skuId,
        fromLocationId: ctx.locationId,
        quantity: magnitude,
        ...withReference,
        ...withActor,
      },
    };
  }

  if (movement.movementType === 'return') {
    return {
      verb: 'receipt',
      args: {
        skuId: ctx.skuId,
        locationId: ctx.locationId,
        quantity: magnitude,
        ...withReference,
        ...withActor,
      },
    };
  }

  // adjust — signed correction, sign preserved.
  return {
    verb: 'adjust',
    args: {
      skuId: ctx.skuId,
      locationId: ctx.locationId,
      delta: movement.quantityDelta,
      ...(reference ? { reason: reference } : {}),
      ...withActor,
    },
  };
}
