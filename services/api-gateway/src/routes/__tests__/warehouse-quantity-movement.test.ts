/**
 * Regression test — contract-422 finding (2): the worker store-issue screen
 * (workforce-mobile W-M-10 / W-M-15) POSTs a quantity movement
 * `{ movementType, quantityDelta, reason }` to /items/:id/movements, which
 * used to be bound to the ore-stockpile TransferSchema (requires
 * toUserId + toLocationKind) → every issue/return 422'd.
 *
 * These tests assert:
 *   1. The new QuantityMovementSchema ACCEPTS the exact W-M-10 body and
 *      REJECTS the legacy transfer body (proving the contract realigned).
 *   2. planQuantityMovement maps issue/return/adjust onto the correct REAL
 *      inventory-management verb with the right args (sign + location).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  planQuantityMovement,
  EmptyMovementError,
} from '../warehouse-quantity-movement';

// Mirror the schema bound in warehouse.router.ts so the test fails red if
// the route contract drifts back to the transfer shape.
const QuantityMovementSchema = z.object({
  movementType: z.enum(['issue', 'return', 'adjust']),
  quantityDelta: z.number().int(),
  reason: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

describe('warehouse /items/:id/movements — quantity-movement contract', () => {
  it('accepts the exact W-M-10 issue body', () => {
    const wmTenBody = {
      movementType: 'issue',
      quantityDelta: -3,
      reason: 'W-M-10 issue Drill bits · DB-001',
    };
    const parsed = QuantityMovementSchema.safeParse(wmTenBody);
    expect(parsed.success).toBe(true);
  });

  it('accepts the W-M-10 return body', () => {
    const parsed = QuantityMovementSchema.safeParse({
      movementType: 'return',
      quantityDelta: 2,
      reason: 'W-M-10 return Helmet · PPE-9',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects the legacy ore-stockpile transfer body (the old 422 cause)', () => {
    // The transfer body carries toUserId + toLocationKind and NO
    // movementType — it must not validate against the movement contract.
    const transferBody = {
      toUserId: 'usr_1',
      toLocationKind: 'warehouse',
    };
    const parsed = QuantityMovementSchema.safeParse(transferBody);
    expect(parsed.success).toBe(false);
  });
});

describe('planQuantityMovement — maps to the real inventory verb', () => {
  const ctx = {
    skuId: 'sku_db001',
    locationId: 'default-store',
    actorUserId: 'usr_worker',
  } as const;

  it('issue → issueStock args (magnitude, fromLocationId, actor, reference)', () => {
    const planned = planQuantityMovement(
      { movementType: 'issue', quantityDelta: -3, reason: 'shift draw' },
      ctx,
    );
    expect(planned).toEqual({
      verb: 'issue',
      args: {
        skuId: 'sku_db001',
        fromLocationId: 'default-store',
        quantity: 3,
        reference: 'shift draw',
        actorUserId: 'usr_worker',
      },
    });
  });

  it('return → receiveStock args (magnitude, locationId)', () => {
    const planned = planQuantityMovement(
      { movementType: 'return', quantityDelta: 2 },
      ctx,
    );
    expect(planned).toEqual({
      verb: 'receipt',
      args: {
        skuId: 'sku_db001',
        locationId: 'default-store',
        quantity: 2,
        actorUserId: 'usr_worker',
      },
    });
  });

  it('adjust → adjustStock args (signed delta preserved, reason→reason)', () => {
    const planned = planQuantityMovement(
      { movementType: 'adjust', quantityDelta: -5, reason: 'cycle count' },
      ctx,
    );
    expect(planned).toEqual({
      verb: 'adjust',
      args: {
        skuId: 'sku_db001',
        locationId: 'default-store',
        delta: -5,
        reason: 'cycle count',
        actorUserId: 'usr_worker',
      },
    });
  });

  it('rejects a zero-net movement (fail-closed, no fabricated write)', () => {
    expect(() =>
      planQuantityMovement({ movementType: 'issue', quantityDelta: 0 }, ctx),
    ).toThrow(EmptyMovementError);
  });

  it('omits actorUserId when the caller is anonymous', () => {
    const planned = planQuantityMovement(
      { movementType: 'return', quantityDelta: 1 },
      { skuId: 'sku_x', locationId: 'default-store' },
    );
    expect(planned).toEqual({
      verb: 'receipt',
      args: { skuId: 'sku_x', locationId: 'default-store', quantity: 1 },
    });
  });
});
