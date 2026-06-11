/**
 * CRDT named-slot merge laws.
 *
 * Verifies the three CRDT laws that make the cross-surface state bus
 * safe over an at-least-once realtime transport:
 *   - commutativity:  merge(a,b) == merge(b,a)
 *   - associativity:  merge(merge(a,b),c) == merge(a,merge(b,c))
 *   - idempotence:    merge(a,a) == a
 * Plus the LWW total-order tie-break (clock -> wall-clock -> actorId)
 * and version-vector join correctness.
 */

import { describe, it, expect } from 'vitest';
import {
  writeSlot,
  deleteSlot,
  mergeSlot,
  dominates,
  joinVersionVectors,
  nextClock,
} from '../slots/slot-crdt.js';
import type { Slot, SlotWriteInput } from '../types.js';

function mkWrite(
  actorId: string,
  value: Record<string, unknown>,
  surface: SlotWriteInput['surface'] = 'chat',
): SlotWriteInput {
  return {
    tenantId: 't1',
    slotId: 'incident:KAH-088:decision',
    slotKind: 'decision',
    value,
    actorId,
    surface,
  };
}

describe('slot-crdt — merge laws', () => {
  it('idempotent: merge(a, a) === a (same value + version)', () => {
    const a = writeSlot(mkWrite('chat:md', { verdict: 'suspend' }), null, 1000);
    const merged = mergeSlot(a, a);
    expect(merged.value).toEqual(a.value);
    expect(merged.writerId).toBe(a.writerId);
    expect(merged.clock).toBe(a.clock);
    expect(merged.version).toEqual(a.version);
    expect(merged.deleted).toBe(a.deleted);
  });

  it('commutative: merge(a, b) === merge(b, a)', () => {
    const a = writeSlot(mkWrite('owner-web:s1', { v: 'A' }), null, 1000);
    // b is a concurrent write by a different actor at a later wall-clock
    const b = writeSlot(mkWrite('mobile:d2', { v: 'B' }), null, 2000);
    const ab = mergeSlot(a, b);
    const ba = mergeSlot(b, a);
    expect(ab.value).toEqual(ba.value);
    expect(ab.writerId).toBe(ba.writerId);
    expect(ab.clock).toBe(ba.clock);
    expect(ab.wallClockMs).toBe(ba.wallClockMs);
    expect(ab.version).toEqual(ba.version);
  });

  it('associative: merge(merge(a,b),c) === merge(a,merge(b,c))', () => {
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const b = writeSlot(mkWrite('b', { v: 'B' }), null, 2000);
    const c = writeSlot(mkWrite('c', { v: 'C' }), null, 1500);
    const left = mergeSlot(mergeSlot(a, b), c);
    const right = mergeSlot(a, mergeSlot(b, c));
    expect(left.value).toEqual(right.value);
    expect(left.writerId).toBe(right.writerId);
    expect(left.clock).toBe(right.clock);
    expect(left.wallClockMs).toBe(right.wallClockMs);
    expect(left.version).toEqual(right.version);
  });

  it('LWW: higher Lamport clock wins regardless of wall-clock', () => {
    const base = writeSlot(mkWrite('a', { v: 'base' }), null, 5000);
    // A causally-later write (advances the clock) but EARLIER wall-clock.
    const later = writeSlot(mkWrite('b', { v: 'later' }), base, 1000);
    expect(later.clock).toBeGreaterThan(base.clock);
    const merged = mergeSlot(base, later);
    expect(merged.value).toEqual({ v: 'later' });
    expect(merged.writerId).toBe('b');
  });

  it('LWW tie-break: equal clock -> higher wall-clock wins', () => {
    // Two genuinely-concurrent first writes (both clock 1).
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const b = writeSlot(mkWrite('b', { v: 'B' }), null, 2000);
    expect(a.clock).toBe(b.clock);
    const merged = mergeSlot(a, b);
    expect(merged.wallClockMs).toBe(2000);
    expect(merged.value).toEqual({ v: 'B' });
  });

  it('LWW final tie-break: equal clock + wall-clock -> greater actorId wins (deterministic)', () => {
    const a = writeSlot(mkWrite('aaa', { v: 'A' }), null, 1000);
    const z = writeSlot(mkWrite('zzz', { v: 'Z' }), null, 1000);
    expect(a.clock).toBe(z.clock);
    expect(a.wallClockMs).toBe(z.wallClockMs);
    const merged = mergeSlot(a, z);
    expect(merged.writerId).toBe('zzz');
    expect(merged.value).toEqual({ v: 'Z' });
  });

  it('merge joins version vectors (no causal history lost)', () => {
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const b = writeSlot(mkWrite('b', { v: 'B' }), null, 2000);
    const merged = mergeSlot(a, b);
    expect(Object.keys(merged.version).sort()).toEqual(['a', 'b']);
    expect(merged.version['a']).toBe(1);
    expect(merged.version['b']).toBe(1);
  });

  it('delete is an LWW write: a higher-clock delete wins over an earlier set', () => {
    const set = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const del = deleteSlot(
      { tenantId: 't1', slotId: set.slotId, actorId: 'b', surface: 'chat' },
      set,
      2000,
    );
    expect(del.clock).toBeGreaterThan(set.clock);
    const merged = mergeSlot(set, del);
    expect(merged.deleted).toBe(true);
    expect(merged.value).toBeNull();
  });

  it('a later set REVIVES a tombstoned slot (single-register semantics)', () => {
    const set = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const del = deleteSlot(
      { tenantId: 't1', slotId: set.slotId, actorId: 'b', surface: 'chat' },
      set,
      2000,
    );
    const revive = writeSlot(mkWrite('c', { v: 'revived' }), del, 3000);
    const merged = mergeSlot(del, revive);
    expect(merged.deleted).toBe(false);
    expect(merged.value).toEqual({ v: 'revived' });
  });

  it('refuses to merge across tenants', () => {
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const b: Slot = { ...a, tenantId: 't2' };
    expect(() => mergeSlot(a, b)).toThrow(/across tenants/);
  });

  it('refuses to merge different slots', () => {
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const b: Slot = { ...a, slotId: 'other' };
    expect(() => mergeSlot(a, b)).toThrow(/different slots/);
  });

  it('produces frozen, immutable slots', () => {
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.value)).toBe(true);
    expect(Object.isFrozen(a.version)).toBe(true);
  });
});

describe('slot-crdt — primitives', () => {
  it('joinVersionVectors takes element-wise max and is idempotent', () => {
    const a = { x: 3, y: 1 };
    const b = { y: 5, z: 2 };
    const j = joinVersionVectors(a, b);
    expect(j).toEqual({ x: 3, y: 5, z: 2 });
    expect(joinVersionVectors(j, j)).toEqual(j);
  });

  it('nextClock advances past the max counter observed', () => {
    const a = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    // Simulate a slot that has seen actor b at clock 9.
    const withHistory: Slot = {
      ...a,
      version: { ...a.version, b: 9 },
    };
    expect(nextClock(withHistory)).toBe(10);
  });

  it('dominates implements the total order', () => {
    const lo = writeSlot(mkWrite('a', { v: 'A' }), null, 1000);
    const hi = writeSlot(mkWrite('b', { v: 'B' }), lo, 1000);
    expect(dominates(hi, lo)).toBe(true);
    expect(dominates(lo, hi)).toBe(false);
  });
});
