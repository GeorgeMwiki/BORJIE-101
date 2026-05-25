import { describe, it, expect } from 'vitest';
import {
  AuthorityLevel,
  DEFAULT_AUTHORITY_FOR_ROLE,
  compareAuthority,
  hasAuthorityAtLeast,
  type AuthorityLevelId,
} from './authority-level.js';

/**
 * Source-of-truth mirror for the 8 RBAC SystemRoles string values.
 *
 * We cannot import `SystemRoles` from `@borjie/authz-policy` here because
 * it would create a circular dependency (authz-policy depends on
 * domain-models). This mirror is kept in lock-step with
 * `packages/authz-policy/src/system-roles.ts` — if the real SystemRoles
 * changes, this list must change too, and the exhaustive test below will
 * fail loudly if they drift.
 */
const EXPECTED_SYSTEM_ROLE_VALUES = [
  'super_admin',
  'platform_support',
  'tenant_admin',
  'property_manager',
  'owner',
  'estate_manager',
  'accountant',
  'customer',
  'viewer',
] as const;

describe('AuthorityLevel enum', () => {
  it('has all 9 entries from the chain-of-command spec', () => {
    const keys = Object.keys(AuthorityLevel).sort();
    expect(keys).toEqual(
      [
        'ADMIN_L1',
        'ADMIN_L2',
        'ADMIN_L3',
        'ADMIN_L4',
        'ESTATE_MANAGER',
        'OWNER',
        'STATION_MASTER',
        'SUPER_ADMIN',
        'WORKER',
      ].sort()
    );
  });

  it('has expected tier values for every entry', () => {
    expect(AuthorityLevel.OWNER.tier).toBe(0);
    expect(AuthorityLevel.SUPER_ADMIN.tier).toBe(1);
    expect(AuthorityLevel.ADMIN_L1.tier).toBe(10);
    expect(AuthorityLevel.ADMIN_L2.tier).toBe(20);
    expect(AuthorityLevel.ADMIN_L3.tier).toBe(30);
    expect(AuthorityLevel.ADMIN_L4.tier).toBe(40);
    expect(AuthorityLevel.ESTATE_MANAGER.tier).toBe(50);
    expect(AuthorityLevel.STATION_MASTER.tier).toBe(60);
    expect(AuthorityLevel.WORKER.tier).toBe(70);
  });

  it('only OWNER can delete the org', () => {
    const deleters = (Object.keys(AuthorityLevel) as AuthorityLevelId[]).filter(
      (id) => AuthorityLevel[id].canDeleteOrg
    );
    expect(deleters).toEqual(['OWNER']);
  });

  it('SUPER_ADMIN has a soft cap of 2 per org', () => {
    expect(AuthorityLevel.SUPER_ADMIN.maxPerOrg).toBe(2);
  });

  it('all non-SUPER_ADMIN levels have no per-org cap', () => {
    const capped = (Object.keys(AuthorityLevel) as AuthorityLevelId[]).filter(
      (id) => AuthorityLevel[id].maxPerOrg !== null
    );
    expect(capped).toEqual(['SUPER_ADMIN']);
  });

  it('tiers are strictly ascending in declaration order', () => {
    const tiers = Object.values(AuthorityLevel).map((descriptor) => descriptor.tier);
    const sorted = [...tiers].sort((a, b) => a - b);
    expect(tiers).toEqual(sorted);
    const unique = new Set(tiers);
    expect(unique.size).toBe(tiers.length);
  });
});

describe('compareAuthority', () => {
  it('returns a negative number when OWNER is compared to WORKER (higher authority)', () => {
    expect(compareAuthority('OWNER', 'WORKER')).toBeLessThan(0);
  });

  it('returns zero when comparing equal levels', () => {
    expect(compareAuthority('ADMIN_L1', 'ADMIN_L1')).toBe(0);
  });

  it('returns a positive number when comparing a lower-authority level to a higher one', () => {
    expect(compareAuthority('WORKER', 'OWNER')).toBeGreaterThan(0);
  });

  it('orders admins correctly: L1 > L2 > L3 > L4', () => {
    expect(compareAuthority('ADMIN_L1', 'ADMIN_L2')).toBeLessThan(0);
    expect(compareAuthority('ADMIN_L2', 'ADMIN_L3')).toBeLessThan(0);
    expect(compareAuthority('ADMIN_L3', 'ADMIN_L4')).toBeLessThan(0);
  });

  it('can be used as an Array.prototype.sort comparator (highest-authority first)', () => {
    const ids: AuthorityLevelId[] = ['WORKER', 'OWNER', 'ADMIN_L2', 'SUPER_ADMIN'];
    const sorted = [...ids].sort(compareAuthority);
    expect(sorted).toEqual(['OWNER', 'SUPER_ADMIN', 'ADMIN_L2', 'WORKER']);
  });
});

describe('DEFAULT_AUTHORITY_FOR_ROLE', () => {
  it('has an entry for every SystemRole (exhaustive)', () => {
    const mappedKeys = Object.keys(DEFAULT_AUTHORITY_FOR_ROLE).sort();
    const expected = [...EXPECTED_SYSTEM_ROLE_VALUES].sort();
    expect(mappedKeys).toEqual(expected);
  });

  it('maps to valid AuthorityLevelIds', () => {
    for (const value of Object.values(DEFAULT_AUTHORITY_FOR_ROLE)) {
      expect(AuthorityLevel[value]).toBeDefined();
    }
  });

  it('maps OWNER role to OWNER authority level', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['owner']).toBe('OWNER');
  });

  it('maps SUPER_ADMIN role to SUPER_ADMIN authority level', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['super_admin']).toBe('SUPER_ADMIN');
  });

  it('maps TENANT_ADMIN role to ADMIN_L1', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['tenant_admin']).toBe('ADMIN_L1');
  });

  it('maps PROPERTY_MANAGER and ACCOUNTANT roles to ADMIN_L3', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['property_manager']).toBe('ADMIN_L3');
    expect(DEFAULT_AUTHORITY_FOR_ROLE['accountant']).toBe('ADMIN_L3');
  });

  it('maps PLATFORM_SUPPORT role to ADMIN_L4', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['platform_support']).toBe('ADMIN_L4');
  });

  it('maps ESTATE_MANAGER role to ESTATE_MANAGER authority level', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['estate_manager']).toBe('ESTATE_MANAGER');
  });

  it('maps CUSTOMER and VIEWER roles to WORKER authority', () => {
    expect(DEFAULT_AUTHORITY_FOR_ROLE['customer']).toBe('WORKER');
    expect(DEFAULT_AUTHORITY_FOR_ROLE['viewer']).toBe('WORKER');
  });
});

describe('hasAuthorityAtLeast', () => {
  it('returns true when subject tier is at or below the required tier', () => {
    expect(hasAuthorityAtLeast({ authorityLevel: 'OWNER' }, 10)).toBe(true);
    expect(hasAuthorityAtLeast({ authorityLevel: 'ADMIN_L1' }, 10)).toBe(true);
  });

  it('returns false when subject tier is above the required tier (lower authority)', () => {
    expect(hasAuthorityAtLeast({ authorityLevel: 'WORKER' }, 10)).toBe(false);
    expect(hasAuthorityAtLeast({ authorityLevel: 'ADMIN_L2' }, 10)).toBe(false);
  });

  it('returns false for subjects with no authorityLevel set', () => {
    expect(hasAuthorityAtLeast({}, 0)).toBe(false);
    expect(hasAuthorityAtLeast({ authorityLevel: undefined }, 70)).toBe(false);
  });
});
