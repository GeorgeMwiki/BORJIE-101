/**
 * Awareness scopes — D9/G5 role × tier composition.
 *
 * Validates:
 *   - composeScope rejects disallowed (role, tier) pairs
 *   - cohort k-floor is boosted for higher-authority roles
 *   - pseudonymisation is forced for analytical/cross-tenant lenses
 *   - the type guard isRoleScope discriminates correctly
 */

import { describe, it, expect } from 'vitest';
import {
  composeScope,
  isRoleScope,
  roleRank,
} from '../kernel/awareness-scopes.js';

describe('composeScope — allowed pairs', () => {
  it('resident @ tenant tier is allowed', () => {
    const r = composeScope('resident', 'tenant');
    expect(isRoleScope(r)).toBe(true);
    if (isRoleScope(r)) {
      expect(r.role).toBe('resident');
      expect(r.tier).toBe('tenant');
      expect(r.minK).toBeGreaterThanOrEqual(5);
      expect(r.requiresPseudonymisation).toBe(false);
    }
  });

  it('manager @ unit tier is allowed', () => {
    const r = composeScope('manager', 'unit');
    expect(isRoleScope(r)).toBe(true);
  });

  it('platform-operator @ industry tier is allowed and requires pseudonymisation', () => {
    const r = composeScope('platform-operator', 'industry');
    expect(isRoleScope(r)).toBe(true);
    if (isRoleScope(r)) {
      expect(r.requiresPseudonymisation).toBe(true);
      expect(r.minK).toBeGreaterThanOrEqual(25 + 15);
    }
  });
});

describe('composeScope — disallowed pairs', () => {
  it('rejects resident @ industry tier', () => {
    const r = composeScope('resident', 'industry');
    expect(isRoleScope(r)).toBe(false);
    if (!isRoleScope(r)) {
      expect(r.reason).toMatch(/resident/);
      expect(r.reason).toMatch(/industry/);
    }
  });

  it('rejects manager @ industry tier', () => {
    const r = composeScope('manager', 'industry');
    expect(isRoleScope(r)).toBe(false);
  });

  it('rejects sovereign-admin @ tenant tier', () => {
    const r = composeScope('sovereign-admin', 'tenant');
    expect(isRoleScope(r)).toBe(false);
  });
});

describe('composeScope — k-floor boosts', () => {
  it('admin role boosts k by 5 above the base tier', () => {
    const r = composeScope('admin', 'property');
    expect(isRoleScope(r)).toBe(true);
    if (isRoleScope(r)) {
      // property base k = 10, +5 admin boost
      expect(r.minK).toBeGreaterThanOrEqual(15);
    }
  });

  it('sovereign-admin role boosts k by 10', () => {
    const r = composeScope('sovereign-admin', 'org');
    expect(isRoleScope(r)).toBe(true);
    if (isRoleScope(r)) {
      // org base k = 20, +10 sovereign boost = 30
      expect(r.minK).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('roleRank ordering', () => {
  it('orders roles from least to most authority', () => {
    expect(roleRank('resident')).toBeLessThan(roleRank('manager'));
    expect(roleRank('manager')).toBeLessThan(roleRank('admin'));
    expect(roleRank('admin')).toBeLessThan(roleRank('sovereign-admin'));
    expect(roleRank('sovereign-admin')).toBeLessThan(
      roleRank('platform-operator'),
    );
  });
});
