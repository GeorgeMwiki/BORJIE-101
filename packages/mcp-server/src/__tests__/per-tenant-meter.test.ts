/**
 * MCP per-tenant calls/day meter regression (LP-20a).
 *
 * Locks the contract:
 *   - reserveCall increments and reports remaining
 *   - blocks at the cap (HTTP-429 signal) without over-counting
 *   - caps are per (tenant, day) — a different day resets, a different
 *     tenant is independent
 *   - tier caps + env override + explicit capOverride
 *   - concurrent reserveCall is linearised (no over-cap race)
 *   - snapshot never mutates
 */
import { describe, it, expect } from 'vitest';
import {
  reserveCall,
  snapshotMeter,
  getTierCallCap,
  currentUtcDay,
  InMemoryMeterStore,
} from '../per-tenant-meter.js';

describe('getTierCallCap', () => {
  it('returns built-in defaults per tier', () => {
    expect(getTierCallCap('standard', {})).toBe(5_000);
    expect(getTierCallCap('pro', {})).toBe(50_000);
    expect(getTierCallCap('enterprise', {})).toBe(500_000);
  });

  it('honours a positive env override', () => {
    expect(getTierCallCap('standard', { BORJIE_MCP_CALLS_STANDARD_DAY: '42' })).toBe(42);
  });

  it('ignores a non-positive / non-numeric env override', () => {
    expect(getTierCallCap('pro', { BORJIE_MCP_CALLS_PRO_DAY: '-1' })).toBe(50_000);
    expect(getTierCallCap('pro', { BORJIE_MCP_CALLS_PRO_DAY: 'abc' })).toBe(50_000);
  });
});

describe('currentUtcDay', () => {
  it('formats a stable YYYY-MM-DD in UTC', () => {
    expect(currentUtcDay(new Date('2026-06-03T23:59:59.999Z'))).toBe('2026-06-03');
  });
});

describe('reserveCall', () => {
  it('increments and reports remaining under the cap', async () => {
    const store = new InMemoryMeterStore();
    const args = { tenantId: 't1', tier: 'standard' as const, store, day: '2026-06-03', capOverride: 3 };

    const a = await reserveCall(args);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.used).toBe(1);
      expect(a.remaining).toBe(2);
    }
  });

  it('blocks at the cap and does not over-count', async () => {
    const store = new InMemoryMeterStore();
    const args = { tenantId: 't1', tier: 'standard' as const, store, day: '2026-06-03', capOverride: 2 };

    expect((await reserveCall(args)).ok).toBe(true); // 1
    expect((await reserveCall(args)).ok).toBe(true); // 2
    const blocked = await reserveCall(args); // 3 -> blocked
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('over-cap');

    // Counter is pinned at the cap, not bumped past it.
    const snap = await snapshotMeter(args);
    expect(snap.used).toBe(2);
    expect(snap.remaining).toBe(0);
  });

  it('scopes counts per (tenant, day)', async () => {
    const store = new InMemoryMeterStore();
    const cap = { capOverride: 1, tier: 'standard' as const, store };

    expect((await reserveCall({ ...cap, tenantId: 'a', day: 'd1' })).ok).toBe(true);
    // same tenant, different day → fresh budget
    expect((await reserveCall({ ...cap, tenantId: 'a', day: 'd2' })).ok).toBe(true);
    // different tenant, same day → independent budget
    expect((await reserveCall({ ...cap, tenantId: 'b', day: 'd1' })).ok).toBe(true);
    // same tenant+day as first → now over cap
    expect((await reserveCall({ ...cap, tenantId: 'a', day: 'd1' })).ok).toBe(false);
  });

  it('linearises concurrent reserveCall (no over-cap race)', async () => {
    const store = new InMemoryMeterStore();
    const args = { tenantId: 't1', tier: 'enterprise' as const, store, day: 'd', capOverride: 5 };

    // 20 concurrent reservations against a cap of 5 — exactly 5 succeed.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveCall(args)),
    );
    const allowed = results.filter((r) => r.ok).length;
    const blocked = results.filter((r) => !r.ok).length;
    expect(allowed).toBe(5);
    expect(blocked).toBe(15);
    expect((await snapshotMeter(args)).used).toBe(5);
  });
});

describe('snapshotMeter', () => {
  it('reads without mutating the counter', async () => {
    const store = new InMemoryMeterStore();
    const args = { tenantId: 't', tier: 'pro' as const, store, day: 'd', capOverride: 10 };
    await reserveCall(args);
    const s1 = await snapshotMeter(args);
    const s2 = await snapshotMeter(args);
    expect(s1.used).toBe(1);
    expect(s2.used).toBe(1); // snapshot did not increment
  });
});
