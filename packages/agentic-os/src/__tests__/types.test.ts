import { describe, expect, it } from 'vitest';
import {
  autonomyToInt,
  intToAutonomy,
  minAutonomy,
  nowIso,
  CapabilityNotFoundError,
  GoalDecompositionError,
  TenantScopeError,
} from '../types.js';

describe('types — pure helpers', () => {
  it('autonomyToInt converts L0..L5 → 0..5', () => {
    expect(autonomyToInt('L0')).toBe(0);
    expect(autonomyToInt('L1')).toBe(1);
    expect(autonomyToInt('L2')).toBe(2);
    expect(autonomyToInt('L3')).toBe(3);
    expect(autonomyToInt('L4')).toBe(4);
    expect(autonomyToInt('L5')).toBe(5);
  });

  it('intToAutonomy clamps to [0,5]', () => {
    expect(intToAutonomy(0)).toBe('L0');
    expect(intToAutonomy(3)).toBe('L3');
    expect(intToAutonomy(5)).toBe('L5');
    expect(intToAutonomy(-1)).toBe('L0');
    expect(intToAutonomy(7)).toBe('L5');
    expect(intToAutonomy(2.6)).toBe('L3');
  });

  it('minAutonomy picks the lower level', () => {
    expect(minAutonomy('L2', 'L4')).toBe('L2');
    expect(minAutonomy('L5', 'L1')).toBe('L1');
    expect(minAutonomy('L3', 'L3')).toBe('L3');
  });

  it('nowIso returns a parseable ISO string', () => {
    const iso = nowIso();
    expect(() => new Date(iso)).not.toThrow();
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('errors carry useful messages', () => {
    const e1 = new CapabilityNotFoundError('lease.renew');
    expect(e1.message).toContain('lease.renew');
    expect(e1.capabilityId).toBe('lease.renew');
    expect(e1.name).toBe('CapabilityNotFoundError');

    const e2 = new GoalDecompositionError('cycle');
    expect(e2.name).toBe('GoalDecompositionError');

    const e3 = new TenantScopeError('missing tenant');
    expect(e3.name).toBe('TenantScopeError');
  });
});
