/**
 * Cycle counts — periodic physical inventory verification.
 *
 * A cycle-count is scheduled against a location, then driven through
 * three states: scheduled → in_progress → completed. Each `recordCount`
 * captures a counted-qty; on close, variances generate adjustment
 * movements automatically so the log carries the audit trail of
 * every correction.
 */

import {
  err,
  ok,
  type CycleCount,
  type CycleCountId,
  type CycleCountMode,
  type CycleCountVariance,
  type LocationId,
  type MovementId,
  type Result,
  type SkuId,
  type StockMovement,
  type TenantId,
  type UserId,
} from '../types.js';
import { adjustStock, currentStock } from '../movements/stock-movements.js';

export function scheduleCycleCount(
  existing: ReadonlyArray<CycleCount>,
  tenantId: TenantId,
  input: {
    readonly locationId: LocationId;
    readonly mode: CycleCountMode;
    readonly scheduledAt: string;
    readonly notes?: string;
  },
  idGen: () => CycleCountId,
): Result<{ readonly cycleCount: CycleCount; readonly counts: ReadonlyArray<CycleCount> }, 'BAD_REQUEST'> {
  if (!input.locationId) return err('BAD_REQUEST', 'locationId required');
  const cycleCount: CycleCount = {
    id: idGen(),
    tenantId,
    locationId: input.locationId,
    mode: input.mode,
    scheduledAt: input.scheduledAt,
    status: 'scheduled',
    variances: [],
    ...(input.notes !== undefined && { notes: input.notes }),
  };
  return ok({ cycleCount, counts: [...existing, cycleCount] });
}

export function startCycleCount(
  existing: ReadonlyArray<CycleCount>,
  tenantId: TenantId,
  cycleCountId: CycleCountId,
  now: string,
): Result<{ readonly cycleCount: CycleCount; readonly counts: ReadonlyArray<CycleCount> }, 'NOT_FOUND' | 'INVALID_STATUS' | 'TENANT_MISMATCH'> {
  const idx = existing.findIndex((c) => c.id === cycleCountId);
  if (idx < 0) return err('NOT_FOUND', `cycle-count ${cycleCountId} not found`);
  const current = existing[idx]!;
  if (current.tenantId !== tenantId) return err('TENANT_MISMATCH', 'cross-tenant access denied');
  if (current.status !== 'scheduled') return err('INVALID_STATUS', `cannot start — status is ${current.status}`);
  const next: CycleCount = { ...current, status: 'in_progress', startedAt: now };
  const counts = [...existing.slice(0, idx), next, ...existing.slice(idx + 1)];
  return ok({ cycleCount: next, counts });
}

/**
 * Record a single (sku, location, countedQty) tuple for an in-progress
 * cycle-count. Variance is the delta between counted vs expected
 * (derived from the movement log at this moment).
 *
 * Append-only — recording the same SKU twice just adds a second
 * variance row. Callers are expected to dedupe at the UI; auditors
 * value seeing every count attempt.
 */
export function recordCount(
  existing: ReadonlyArray<CycleCount>,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  cycleCountId: CycleCountId,
  input: { readonly skuId: SkuId; readonly countedQty: number },
): Result<{ readonly cycleCount: CycleCount; readonly counts: ReadonlyArray<CycleCount> }, 'NOT_FOUND' | 'INVALID_STATUS' | 'TENANT_MISMATCH' | 'BAD_REQUEST'> {
  if (!Number.isFinite(input.countedQty) || input.countedQty < 0) {
    return err('BAD_REQUEST', 'countedQty must be a non-negative finite number');
  }
  const idx = existing.findIndex((c) => c.id === cycleCountId);
  if (idx < 0) return err('NOT_FOUND', `cycle-count ${cycleCountId} not found`);
  const current = existing[idx]!;
  if (current.tenantId !== tenantId) return err('TENANT_MISMATCH', 'cross-tenant access denied');
  if (current.status !== 'in_progress') return err('INVALID_STATUS', `must be in_progress (got ${current.status})`);
  const expected = currentStock(log, tenantId, input.skuId, current.locationId);
  const variance: CycleCountVariance = {
    skuId: input.skuId,
    locationId: current.locationId,
    expectedQty: expected,
    countedQty: input.countedQty,
    delta: input.countedQty - expected,
  };
  const next: CycleCount = { ...current, variances: [...current.variances, variance] };
  const counts = [...existing.slice(0, idx), next, ...existing.slice(idx + 1)];
  return ok({ cycleCount: next, counts });
}

export interface CloseResult {
  readonly cycleCount: CycleCount;
  readonly counts: ReadonlyArray<CycleCount>;
  readonly adjustments: ReadonlyArray<StockMovement>;
  readonly log: ReadonlyArray<StockMovement>;
}

/**
 * Close the cycle-count and generate adjustment movements for every
 * non-zero variance. Each adjustment carries the cycle-count id as
 * `reference` so the auditor can join cycle-counts → adjustments later.
 *
 * Idempotent at the close gate — closing an already-completed count
 * returns `INVALID_STATUS`.
 */
export function closeCycleCount(
  existing: ReadonlyArray<CycleCount>,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  cycleCountId: CycleCountId,
  idGen: () => MovementId,
  now: string,
  actorUserId?: UserId,
): Result<CloseResult, 'NOT_FOUND' | 'INVALID_STATUS' | 'TENANT_MISMATCH' | 'BAD_REQUEST'> {
  const idx = existing.findIndex((c) => c.id === cycleCountId);
  if (idx < 0) return err('NOT_FOUND', `cycle-count ${cycleCountId} not found`);
  const current = existing[idx]!;
  if (current.tenantId !== tenantId) return err('TENANT_MISMATCH', 'cross-tenant access denied');
  if (current.status !== 'in_progress') return err('INVALID_STATUS', `cannot close — status is ${current.status}`);
  let nextLog = log;
  const adjustments: StockMovement[] = [];
  // Coalesce variances per (sku, location) — the final qty is the LAST
  // recorded count, which is the rule operators expect ("recount wins").
  const finalCounts = new Map<string, CycleCountVariance>();
  for (const v of current.variances) {
    finalCounts.set(`${v.skuId}::${v.locationId}`, v);
  }
  for (const v of finalCounts.values()) {
    if (v.delta === 0) continue;
    const r = adjustStock(
      nextLog,
      tenantId,
      {
        skuId: v.skuId,
        locationId: v.locationId,
        delta: v.delta,
        reference: `cycle-count:${current.id}`,
        ...(actorUserId !== undefined && { actorUserId }),
        reason: `cycle-count variance ${v.delta > 0 ? 'find' : 'loss'}`,
      },
      idGen,
      now,
    );
    if (!r.ok) return err('BAD_REQUEST', r.error.message);
    nextLog = r.value.log;
    adjustments.push(r.value.movement);
  }
  const next: CycleCount = { ...current, status: 'completed', completedAt: now };
  const counts = [...existing.slice(0, idx), next, ...existing.slice(idx + 1)];
  return ok({ cycleCount: next, counts, adjustments, log: nextLog });
}

/**
 * Random-sample selector — return `sampleSize` SKUs at random from
 * the SKUs that have a non-zero on-hand at the given location.
 * Caller passes a deterministic random source for testability.
 */
export function sampleSkusForCount(
  candidateSkuIds: ReadonlyArray<SkuId>,
  sampleSize: number,
  rng: () => number,
): ReadonlyArray<SkuId> {
  if (sampleSize >= candidateSkuIds.length) return [...candidateSkuIds];
  // Fisher-Yates partial shuffle.
  const arr = [...candidateSkuIds];
  for (let i = 0; i < sampleSize; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, sampleSize);
}
