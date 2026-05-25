/**
 * Stock movements — append-only event log.
 *
 * Every change to stock-on-hand passes through `appendMovement`. Current
 * stock is derived by replay (`currentStock`). The four high-level
 * verbs — `receiveStock`, `issueStock`, `transferStock`, `adjustStock`
 * — are thin wrappers that emit the right movement shape.
 *
 * Rationale: an audit log that is the source of truth (rather than a
 * mutable balance + a separate audit trail) eliminates drift and
 * survives compliance reviews unchanged. Cycle-count corrections
 * generate `adjustment` rows so the explanation lives in the event log.
 */

import { z } from 'zod';
import {
  err,
  ITEM_CONDITIONS,
  MOVEMENT_REASONS,
  ok,
  type ItemCondition,
  type LocationId,
  type MovementId,
  type MovementReason,
  type Result,
  type SkuId,
  type StockMovement,
  type TenantId,
  type UserId,
} from '../types.js';

const ReasonSchema = z.enum(MOVEMENT_REASONS);
const ConditionSchema = z.enum(ITEM_CONDITIONS);

export const MovementDraftSchema = z.object({
  skuId: z.string().min(1),
  fromLocationId: z.string().nullable(),
  toLocationId: z.string().nullable(),
  quantity: z.number().refine((v) => Number.isFinite(v) && v !== 0, 'quantity must be finite and non-zero'),
  reason: ReasonSchema,
  condition: ConditionSchema.optional(),
  reference: z.string().max(200).optional(),
  actorUserId: z.string().optional(),
  assetSerialId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export type MovementDraft = z.infer<typeof MovementDraftSchema>;

export function appendMovement(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  draft: MovementDraft,
  idGen: () => MovementId,
  now: string,
): Result<{ readonly movement: StockMovement; readonly log: ReadonlyArray<StockMovement> }, 'BAD_REQUEST'> {
  const parsed = MovementDraftSchema.safeParse(draft);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  // Reason-shape consistency.
  switch (parsed.data.reason) {
    case 'receipt':
      if (!parsed.data.toLocationId) return err('BAD_REQUEST', 'receipt requires toLocationId');
      if (parsed.data.quantity <= 0) return err('BAD_REQUEST', 'receipt quantity must be positive');
      break;
    case 'issue':
    case 'damage':
    case 'loss':
    case 'theft':
    case 'uninstall':
      if (!parsed.data.fromLocationId) return err('BAD_REQUEST', `${parsed.data.reason} requires fromLocationId`);
      if (parsed.data.quantity <= 0) return err('BAD_REQUEST', `${parsed.data.reason} quantity must be positive`);
      break;
    case 'install':
      if (!parsed.data.fromLocationId || !parsed.data.toLocationId) {
        return err('BAD_REQUEST', 'install requires fromLocationId and toLocationId');
      }
      if (parsed.data.quantity <= 0) return err('BAD_REQUEST', 'install quantity must be positive');
      break;
    case 'transfer':
      if (!parsed.data.fromLocationId || !parsed.data.toLocationId) {
        return err('BAD_REQUEST', 'transfer requires fromLocationId and toLocationId');
      }
      if (parsed.data.fromLocationId === parsed.data.toLocationId) {
        return err('BAD_REQUEST', 'transfer requires distinct from/to locations');
      }
      if (parsed.data.quantity <= 0) return err('BAD_REQUEST', 'transfer quantity must be positive');
      break;
    case 'adjustment':
      if (!parsed.data.toLocationId && !parsed.data.fromLocationId) {
        return err('BAD_REQUEST', 'adjustment requires at least one location');
      }
      // Adjustments may be negative (loss-side correction) or positive (find-side).
      break;
    case 'return':
      if (!parsed.data.toLocationId) return err('BAD_REQUEST', 'return requires toLocationId');
      if (parsed.data.quantity <= 0) return err('BAD_REQUEST', 'return quantity must be positive');
      break;
  }
  const movement: StockMovement = {
    id: idGen(),
    tenantId,
    skuId: parsed.data.skuId,
    fromLocationId: parsed.data.fromLocationId,
    toLocationId: parsed.data.toLocationId,
    quantity: parsed.data.quantity,
    reason: parsed.data.reason,
    ...(parsed.data.condition !== undefined && { condition: parsed.data.condition }),
    ...(parsed.data.reference !== undefined && { reference: parsed.data.reference }),
    ...(parsed.data.actorUserId !== undefined && { actorUserId: parsed.data.actorUserId }),
    ...(parsed.data.assetSerialId !== undefined && { assetSerialId: parsed.data.assetSerialId }),
    ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    occurredAt: now,
  };
  return ok({ movement, log: [...log, movement] });
}

// ─────────────────────────────────────────────────────────────────────
// High-level verbs — wrap appendMovement with the right shape
// ─────────────────────────────────────────────────────────────────────

export function receiveStock(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  input: {
    readonly skuId: SkuId;
    readonly locationId: LocationId;
    readonly quantity: number;
    readonly condition?: ItemCondition;
    readonly reference?: string;
    readonly actorUserId?: UserId;
    readonly notes?: string;
  },
  idGen: () => MovementId,
  now: string,
) {
  return appendMovement(
    log,
    tenantId,
    {
      skuId: input.skuId,
      fromLocationId: null,
      toLocationId: input.locationId,
      quantity: input.quantity,
      reason: 'receipt',
      ...(input.condition !== undefined && { condition: input.condition }),
      ...(input.reference !== undefined && { reference: input.reference }),
      ...(input.actorUserId !== undefined && { actorUserId: input.actorUserId }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    idGen,
    now,
  );
}

export function issueStock(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  input: {
    readonly skuId: SkuId;
    readonly fromLocationId: LocationId;
    readonly quantity: number;
    readonly reference?: string;
    readonly actorUserId?: UserId;
    readonly notes?: string;
  },
  idGen: () => MovementId,
  now: string,
): Result<{ readonly movement: StockMovement; readonly log: ReadonlyArray<StockMovement> }, 'BAD_REQUEST' | 'INSUFFICIENT_STOCK'> {
  // Check current stock first.
  const have = currentStock(log, tenantId, input.skuId, input.fromLocationId);
  if (have < input.quantity) {
    return err('INSUFFICIENT_STOCK', `have ${have}, requested ${input.quantity}`);
  }
  return appendMovement(
    log,
    tenantId,
    {
      skuId: input.skuId,
      fromLocationId: input.fromLocationId,
      toLocationId: null,
      quantity: input.quantity,
      reason: 'issue',
      ...(input.reference !== undefined && { reference: input.reference }),
      ...(input.actorUserId !== undefined && { actorUserId: input.actorUserId }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    idGen,
    now,
  );
}

export function transferStock(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  input: {
    readonly skuId: SkuId;
    readonly fromLocationId: LocationId;
    readonly toLocationId: LocationId;
    readonly quantity: number;
    readonly reference?: string;
    readonly actorUserId?: UserId;
  },
  idGen: () => MovementId,
  now: string,
): Result<{ readonly movement: StockMovement; readonly log: ReadonlyArray<StockMovement> }, 'BAD_REQUEST' | 'INSUFFICIENT_STOCK'> {
  const have = currentStock(log, tenantId, input.skuId, input.fromLocationId);
  if (have < input.quantity) {
    return err('INSUFFICIENT_STOCK', `have ${have}, requested ${input.quantity}`);
  }
  return appendMovement(
    log,
    tenantId,
    {
      skuId: input.skuId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      quantity: input.quantity,
      reason: 'transfer',
      ...(input.reference !== undefined && { reference: input.reference }),
      ...(input.actorUserId !== undefined && { actorUserId: input.actorUserId }),
    },
    idGen,
    now,
  );
}

/**
 * Adjust stock by a signed delta. Positive = found stock (find-side
 * cycle-count correction). Negative = missing stock (loss-side
 * correction). The movement row uses the absolute quantity, with
 * `fromLocationId` set for negatives and `toLocationId` for positives.
 */
export function adjustStock(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  input: {
    readonly skuId: SkuId;
    readonly locationId: LocationId;
    readonly delta: number;
    readonly reason?: string;
    readonly actorUserId?: UserId;
    readonly reference?: string;
  },
  idGen: () => MovementId,
  now: string,
): Result<{ readonly movement: StockMovement; readonly log: ReadonlyArray<StockMovement> }, 'BAD_REQUEST'> {
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    return err('BAD_REQUEST', 'adjustment delta must be non-zero');
  }
  const isPositive = input.delta > 0;
  return appendMovement(
    log,
    tenantId,
    {
      skuId: input.skuId,
      fromLocationId: isPositive ? null : input.locationId,
      toLocationId: isPositive ? input.locationId : null,
      quantity: Math.abs(input.delta),
      reason: 'adjustment',
      ...(input.actorUserId !== undefined && { actorUserId: input.actorUserId }),
      ...(input.reference !== undefined && { reference: input.reference }),
      ...(input.reason !== undefined && { notes: input.reason }),
    },
    idGen,
    now,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Derive current stock — the only read path
// ─────────────────────────────────────────────────────────────────────

/**
 * Current stock of `skuId` at `locationId` for `tenantId`. Replays the
 * full log. For a million-row log this is O(n) but trivially indexable
 * — the persistence adapter can maintain a running balance table.
 */
export function currentStock(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  skuId: SkuId,
  locationId: LocationId,
): number {
  let total = 0;
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.skuId !== skuId) continue;
    if (m.toLocationId === locationId) total += m.quantity;
    if (m.fromLocationId === locationId) total -= m.quantity;
  }
  return total;
}

export interface StockBalance {
  readonly skuId: SkuId;
  readonly locationId: LocationId;
  readonly quantity: number;
}

export function allBalances(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
): ReadonlyArray<StockBalance> {
  const balances = new Map<string, number>();
  const ensure = (sku: SkuId, loc: LocationId) => {
    const key = `${sku}::${loc}`;
    return key;
  };
  for (const m of log) {
    if (m.tenantId !== tenantId) continue;
    if (m.toLocationId) {
      const key = ensure(m.skuId, m.toLocationId);
      balances.set(key, (balances.get(key) ?? 0) + m.quantity);
    }
    if (m.fromLocationId) {
      const key = ensure(m.skuId, m.fromLocationId);
      balances.set(key, (balances.get(key) ?? 0) - m.quantity);
    }
  }
  const out: StockBalance[] = [];
  for (const [k, q] of balances) {
    const [skuId, locationId] = k.split('::') as [SkuId, LocationId];
    if (q !== 0) out.push({ skuId, locationId, quantity: q });
  }
  return out;
}

/**
 * Movement history for a given SKU. Filterable by location.
 */
export function movementHistory(
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  skuId: SkuId,
  filter?: { readonly locationId?: LocationId; readonly reason?: MovementReason },
): ReadonlyArray<StockMovement> {
  return log.filter((m) => {
    if (m.tenantId !== tenantId) return false;
    if (m.skuId !== skuId) return false;
    if (filter?.reason && m.reason !== filter.reason) return false;
    if (filter?.locationId) {
      if (m.fromLocationId !== filter.locationId && m.toLocationId !== filter.locationId) return false;
    }
    return true;
  });
}
