/**
 * Cycle-count tests — schedule → start → record → close, variance to
 * adjustment, recount-wins, random sampling.
 */

import { describe, it, expect } from 'vitest';
import {
  closeCycleCount,
  recordCount,
  sampleSkusForCount,
  scheduleCycleCount,
  startCycleCount,
} from '../cycle-counts/cycle-counts.js';
import { receiveStock, currentStock } from '../movements/stock-movements.js';
import type { CycleCount, CycleCountId, MovementId, SkuId, StockMovement } from '../types.js';

const tenantId = 't-1';
const wA = 'loc-warehouse-a';

function gen(prefix: string) {
  let i = 0;
  return () => `${prefix}-${++i}`;
}

describe('schedule / start / close happy path', () => {
  it('walks scheduled → in_progress → completed', () => {
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    expect(sched.value.cycleCount.status).toBe('scheduled');
    const started = startCycleCount(sched.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    if (!started.ok) throw new Error('start');
    expect(started.value.cycleCount.status).toBe('in_progress');
    const closed = closeCycleCount(started.value.counts, [], tenantId, sched.value.cycleCount.id, gen('m') as () => MovementId, '2026-05-25T10:00:00Z');
    if (!closed.ok) throw new Error('close');
    expect(closed.value.cycleCount.status).toBe('completed');
    expect(closed.value.adjustments).toHaveLength(0);
  });

  it('refuses to start an already started count', () => {
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const started = startCycleCount(sched.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    if (!started.ok) throw new Error('start');
    const again = startCycleCount(started.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:30:00Z');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('INVALID_STATUS');
  });
});

describe('record + close with variance', () => {
  it('generates adjustment movement for a positive variance', () => {
    // Stock receipt of 100, count finds 105.
    const seed = receiveStock([], tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 100 }, gen('m') as () => MovementId, '2026-05-20T00:00:00Z');
    if (!seed.ok) throw new Error('seed');
    let log: ReadonlyArray<StockMovement> = seed.value.log;
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const started = startCycleCount(sched.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    if (!started.ok) throw new Error('start');
    const recorded = recordCount(started.value.counts, log, tenantId, sched.value.cycleCount.id, { skuId: 'sku-1' as SkuId, countedQty: 105 });
    if (!recorded.ok) throw new Error('record');
    const closed = closeCycleCount(recorded.value.counts, log, tenantId, sched.value.cycleCount.id, gen('a') as () => MovementId, '2026-05-25T10:00:00Z');
    if (!closed.ok) throw new Error('close');
    expect(closed.value.adjustments).toHaveLength(1);
    log = closed.value.log;
    expect(currentStock(log, tenantId, 'sku-1', wA)).toBe(105);
  });

  it('generates adjustment movement for a negative variance', () => {
    const seed = receiveStock([], tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 100 }, gen('m') as () => MovementId, '2026-05-20T00:00:00Z');
    if (!seed.ok) throw new Error('seed');
    let log: ReadonlyArray<StockMovement> = seed.value.log;
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const started = startCycleCount(sched.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    if (!started.ok) throw new Error('start');
    const recorded = recordCount(started.value.counts, log, tenantId, sched.value.cycleCount.id, { skuId: 'sku-1' as SkuId, countedQty: 95 });
    if (!recorded.ok) throw new Error('record');
    const closed = closeCycleCount(recorded.value.counts, log, tenantId, sched.value.cycleCount.id, gen('a') as () => MovementId, '2026-05-25T10:00:00Z');
    if (!closed.ok) throw new Error('close');
    expect(closed.value.adjustments).toHaveLength(1);
    log = closed.value.log;
    expect(currentStock(log, tenantId, 'sku-1', wA)).toBe(95);
    // Reference should mark the source cycle-count for audit.
    expect(closed.value.adjustments[0]!.reference).toMatch(/^cycle-count:/);
  });

  it('coalesces recount-wins per (sku, location)', () => {
    const seed = receiveStock([], tenantId, { skuId: 'sku-1' as SkuId, locationId: wA, quantity: 100 }, gen('m') as () => MovementId, '2026-05-20T00:00:00Z');
    if (!seed.ok) throw new Error('seed');
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const started = startCycleCount(sched.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    if (!started.ok) throw new Error('start');
    const r1 = recordCount(started.value.counts, seed.value.log, tenantId, sched.value.cycleCount.id, { skuId: 'sku-1' as SkuId, countedQty: 80 });
    if (!r1.ok) throw new Error('record');
    const r2 = recordCount(r1.value.counts, seed.value.log, tenantId, sched.value.cycleCount.id, { skuId: 'sku-1' as SkuId, countedQty: 95 });
    if (!r2.ok) throw new Error('record');
    const closed = closeCycleCount(r2.value.counts, seed.value.log, tenantId, sched.value.cycleCount.id, gen('a') as () => MovementId, '2026-05-25T10:00:00Z');
    if (!closed.ok) throw new Error('close');
    expect(closed.value.adjustments).toHaveLength(1); // ONE adjustment from the last recount
    expect(currentStock(closed.value.log, tenantId, 'sku-1', wA)).toBe(95);
  });

  it('cross-tenant access is rejected', () => {
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const r = startCycleCount(sched.value.counts, 'attacker', sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('TENANT_MISMATCH');
  });

  it('record requires in_progress status', () => {
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const r = recordCount(sched.value.counts, [], tenantId, sched.value.cycleCount.id, { skuId: 'sku-1' as SkuId, countedQty: 5 });
    expect(r.ok).toBe(false);
  });

  it('record refuses negative count', () => {
    const sched = scheduleCycleCount([], tenantId, { locationId: wA, mode: 'full', scheduledAt: '2026-05-25T08:00:00Z' }, gen('cc') as () => CycleCountId);
    if (!sched.ok) throw new Error('seed');
    const started = startCycleCount(sched.value.counts, tenantId, sched.value.cycleCount.id, '2026-05-25T09:00:00Z');
    if (!started.ok) throw new Error('start');
    const r = recordCount(started.value.counts, [], tenantId, sched.value.cycleCount.id, { skuId: 'sku-1' as SkuId, countedQty: -1 });
    expect(r.ok).toBe(false);
  });
});

describe('sampleSkusForCount', () => {
  it('returns the full set when sample size meets/exceeds candidates', () => {
    const out = sampleSkusForCount(['a', 'b', 'c'] as SkuId[], 10, Math.random);
    expect(out).toHaveLength(3);
  });

  it('returns sampleSize results with a deterministic rng', () => {
    const rng = (() => {
      const seq = [0.1, 0.2, 0.3, 0.4];
      let i = 0;
      return () => seq[i++ % seq.length]!;
    })();
    const out = sampleSkusForCount(['a', 'b', 'c', 'd', 'e'] as SkuId[], 2, rng);
    expect(out).toHaveLength(2);
  });
});
