import { describe, expect, it } from 'vitest';
import {
  decideEmit,
  emptyCardinalityState,
  labelSignature,
  tenantCardinality,
  type CardinalityLimits,
} from '../cardinality-limits.js';
import type { TenantId } from '../types.js';

const t1 = 't1' as TenantId;
const t2 = 't2' as TenantId;
const lim: CardinalityLimits = { perTenantPerMetric: 3, perTenantTotal: 5 };

describe('cardinality-limits', () => {
  it('labelSignature is order-independent', () => {
    expect(labelSignature({ a: '1', b: '2' })).toBe(labelSignature({ b: '2', a: '1' }));
  });

  it('first emit admits + updates state', () => {
    const out = decideEmit(emptyCardinalityState(), t1, 'm1', { a: '1' }, lim);
    expect(out.admit).toBe(true);
    expect(tenantCardinality(out.state, t1)).toBe(1);
  });

  it('duplicate emit admits without state change', () => {
    let s = emptyCardinalityState();
    s = (decideEmit(s, t1, 'm1', { a: '1' }, lim) as { state: typeof s }).state;
    const out = decideEmit(s, t1, 'm1', { a: '1' }, lim);
    expect(out.admit).toBe(true);
    expect(tenantCardinality(out.state, t1)).toBe(1);
  });

  it('exceeding per-metric cap rejects', () => {
    let s = emptyCardinalityState();
    s = (decideEmit(s, t1, 'm1', { a: '1' }, lim) as { state: typeof s }).state;
    s = (decideEmit(s, t1, 'm1', { a: '2' }, lim) as { state: typeof s }).state;
    s = (decideEmit(s, t1, 'm1', { a: '3' }, lim) as { state: typeof s }).state;
    const out = decideEmit(s, t1, 'm1', { a: '4' }, lim);
    expect(out.admit).toBe(false);
    if (!out.admit) expect(out.reason).toBe('per-metric-cap');
  });

  it('exceeding per-tenant total cap rejects', () => {
    const tightLim: CardinalityLimits = { perTenantPerMetric: 10, perTenantTotal: 2 };
    let s = emptyCardinalityState();
    s = (decideEmit(s, t1, 'm1', { a: '1' }, tightLim) as { state: typeof s }).state;
    s = (decideEmit(s, t1, 'm2', { b: '1' }, tightLim) as { state: typeof s }).state;
    const out = decideEmit(s, t1, 'm3', { c: '1' }, tightLim);
    expect(out.admit).toBe(false);
    if (!out.admit) expect(out.reason).toBe('per-tenant-cap');
  });

  it('tenants are isolated', () => {
    let s = emptyCardinalityState();
    for (let i = 0; i < 3; i++) {
      s = (decideEmit(s, t1, 'm1', { a: String(i) }, lim) as { state: typeof s }).state;
    }
    // t1 is at per-metric cap, t2 should still be admitted
    const out = decideEmit(s, t2, 'm1', { a: '1' }, lim);
    expect(out.admit).toBe(true);
  });

  it('tenantCardinality sums across metrics', () => {
    let s = emptyCardinalityState();
    s = (decideEmit(s, t1, 'm1', { a: '1' }, lim) as { state: typeof s }).state;
    s = (decideEmit(s, t1, 'm2', { b: '1' }, lim) as { state: typeof s }).state;
    expect(tenantCardinality(s, t1)).toBe(2);
  });

  it('rejection does not advance state', () => {
    const tightLim: CardinalityLimits = { perTenantPerMetric: 1 };
    let s = emptyCardinalityState();
    s = (decideEmit(s, t1, 'm1', { a: '1' }, tightLim) as { state: typeof s }).state;
    const before = tenantCardinality(s, t1);
    const out = decideEmit(s, t1, 'm1', { a: '2' }, tightLim);
    expect(out.admit).toBe(false);
    expect(tenantCardinality(out.state, t1)).toBe(before);
  });

  it('handles per-tenant total cap absence', () => {
    const open: CardinalityLimits = { perTenantPerMetric: 10 };
    const out = decideEmit(emptyCardinalityState(), t1, 'm', { a: 'x' }, open);
    expect(out.admit).toBe(true);
  });

  it('default state has zero cardinality', () => {
    expect(tenantCardinality(emptyCardinalityState(), t1)).toBe(0);
  });
});
