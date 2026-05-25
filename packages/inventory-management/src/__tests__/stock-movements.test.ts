/**
 * Movement engine tests — receipts add, issues subtract, transfers
 * move, adjustments can be positive or negative, and the log stays
 * immutable.
 */

import { describe, it, expect } from 'vitest';
import {
  adjustStock,
  allBalances,
  appendMovement,
  currentStock,
  issueStock,
  movementHistory,
  receiveStock,
  transferStock,
} from '../movements/stock-movements.js';
import type { MovementId, StockMovement } from '../types.js';

const tenantId = 't-1';
const skuId = 'sku-1';
const wA = 'loc-warehouse-a';
const wB = 'loc-warehouse-b';

function gen(prefix: string) {
  let i = 0;
  return () => `${prefix}-${++i}` as MovementId;
}

describe('receiveStock', () => {
  it('adds quantity to the destination', () => {
    const r = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 100 }, gen('m'), '2026-05-01T00:00:00Z');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(currentStock(r.value.log, tenantId, skuId, wA)).toBe(100);
  });

  it('rejects a non-positive quantity', () => {
    const r = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 0 }, gen('m'), '2026-05-01T00:00:00Z');
    expect(r.ok).toBe(false);
  });

  it('preserves immutability of the input log', () => {
    const log: ReadonlyArray<StockMovement> = [];
    receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 5 }, gen('m'), '2026-05-01T00:00:00Z');
    expect(log).toHaveLength(0);
  });
});

describe('issueStock', () => {
  it('subtracts quantity when stock is available', () => {
    const seeded = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 50 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seeded.ok) throw new Error('seed');
    const r = issueStock(seeded.value.log, tenantId, { skuId, fromLocationId: wA, quantity: 20 }, gen('i'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(currentStock(r.value.log, tenantId, skuId, wA)).toBe(30);
  });

  it('returns INSUFFICIENT_STOCK when issue exceeds on-hand', () => {
    const seeded = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 5 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seeded.ok) throw new Error('seed');
    const r = issueStock(seeded.value.log, tenantId, { skuId, fromLocationId: wA, quantity: 10 }, gen('i'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('transferStock', () => {
  it('moves quantity between locations', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const r1 = receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 80 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!r1.ok) throw new Error('seed');
    log = r1.value.log;
    const r2 = transferStock(log, tenantId, { skuId, fromLocationId: wA, toLocationId: wB, quantity: 30 }, gen('t'), '2026-05-02T00:00:00Z');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(currentStock(r2.value.log, tenantId, skuId, wA)).toBe(50);
    expect(currentStock(r2.value.log, tenantId, skuId, wB)).toBe(30);
  });

  it('refuses same-location transfer', () => {
    const seeded = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seeded.ok) throw new Error('seed');
    const r = transferStock(seeded.value.log, tenantId, { skuId, fromLocationId: wA, toLocationId: wA, quantity: 1 }, gen('t'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(false);
  });

  it('blocks transfer above on-hand', () => {
    const seeded = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 2 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seeded.ok) throw new Error('seed');
    const r = transferStock(seeded.value.log, tenantId, { skuId, fromLocationId: wA, toLocationId: wB, quantity: 100 }, gen('t'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('adjustStock', () => {
  it('handles positive (find-side) deltas', () => {
    const seeded = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seeded.ok) throw new Error('seed');
    const r = adjustStock(seeded.value.log, tenantId, { skuId, locationId: wA, delta: +5, reason: 'find' }, gen('a'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(currentStock(r.value.log, tenantId, skuId, wA)).toBe(15);
  });

  it('handles negative (loss-side) deltas', () => {
    const seeded = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 10 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!seeded.ok) throw new Error('seed');
    const r = adjustStock(seeded.value.log, tenantId, { skuId, locationId: wA, delta: -3 }, gen('a'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(currentStock(r.value.log, tenantId, skuId, wA)).toBe(7);
  });

  it('rejects a zero delta', () => {
    const r = adjustStock([], tenantId, { skuId, locationId: wA, delta: 0 }, gen('a'), '2026-05-02T00:00:00Z');
    expect(r.ok).toBe(false);
  });
});

describe('allBalances + movementHistory', () => {
  it('aggregates balances across (sku, location)', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 50 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = receiveStock(log, tenantId, { skuId: 'sku-2', locationId: wB, quantity: 30 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const balances = allBalances(log, tenantId);
    expect(balances).toHaveLength(2);
  });

  it('filters movement history by reason and location', () => {
    let log: ReadonlyArray<StockMovement> = [];
    const a = receiveStock(log, tenantId, { skuId, locationId: wA, quantity: 50 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed'); log = a.value.log;
    const b = issueStock(log, tenantId, { skuId, fromLocationId: wA, quantity: 10 }, gen('i'), '2026-05-02T00:00:00Z');
    if (!b.ok) throw new Error('seed'); log = b.value.log;
    const receipts = movementHistory(log, tenantId, skuId, { reason: 'receipt' });
    expect(receipts).toHaveLength(1);
    const allForLocation = movementHistory(log, tenantId, skuId, { locationId: wA });
    expect(allForLocation).toHaveLength(2);
  });

  it('isolates by tenant', () => {
    const a = receiveStock([], tenantId, { skuId, locationId: wA, quantity: 50 }, gen('m'), '2026-05-01T00:00:00Z');
    if (!a.ok) throw new Error('seed');
    expect(currentStock(a.value.log, 'attacker', skuId, wA)).toBe(0);
  });
});

describe('appendMovement raw guards', () => {
  it('refuses an install missing one of the two locations', () => {
    const r = appendMovement(
      [],
      tenantId,
      { skuId, fromLocationId: null, toLocationId: wA, quantity: 1, reason: 'install' },
      gen('m'),
      '2026-05-01T00:00:00Z',
    );
    expect(r.ok).toBe(false);
  });

  it('refuses receipt with toLocationId null', () => {
    const r = appendMovement(
      [],
      tenantId,
      { skuId, fromLocationId: null, toLocationId: null, quantity: 1, reason: 'receipt' },
      gen('m'),
      '2026-05-01T00:00:00Z',
    );
    expect(r.ok).toBe(false);
  });
});
