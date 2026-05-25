import { describe, expect, it } from 'vitest';

import { DisclosureTier } from '../../tier-taxonomy/index.js';
import {
  type AuthInjectedPrincipal,
  type PrincipalRole,
  ROLE_TIER_MAP,
  getDisclosureTierForPrincipal,
  getDisclosureTierWithReason,
  isKnownRole,
  rejectUserSuppliedRoleHeaders,
} from '../index.js';

const authPrincipal = (role: PrincipalRole): AuthInjectedPrincipal => ({
  id: `usr_${role}`,
  role,
  tenantId: 'tnt_acme',
  source: 'auth-middleware',
});

describe('role-gate: ROLE_TIER_MAP', () => {
  it('covers all 8 PrincipalRoles', () => {
    expect(Object.keys(ROLE_TIER_MAP)).toHaveLength(8);
  });

  it('tenant-customer → SAFE', () => {
    expect(ROLE_TIER_MAP['tenant-customer']).toBe(DisclosureTier.SAFE);
  });
  it('property-owner → SAFE', () => {
    expect(ROLE_TIER_MAP['property-owner']).toBe(DisclosureTier.SAFE);
  });
  it('internal-cs-agent → HIGH_RISK', () => {
    expect(ROLE_TIER_MAP['internal-cs-agent']).toBe(DisclosureTier.HIGH_RISK);
  });
  it('platform-admin → HIGH_RISK', () => {
    expect(ROLE_TIER_MAP['platform-admin']).toBe(DisclosureTier.HIGH_RISK);
  });
  it('security-engineer → NEVER', () => {
    expect(ROLE_TIER_MAP['security-engineer']).toBe(DisclosureTier.NEVER);
  });
  it('unauthenticated → SAFE', () => {
    expect(ROLE_TIER_MAP.unauthenticated).toBe(DisclosureTier.SAFE);
  });

  it('ROLE_TIER_MAP is frozen', () => {
    expect(Object.isFrozen(ROLE_TIER_MAP)).toBe(true);
  });
});

describe('role-gate: getDisclosureTierForPrincipal', () => {
  it('returns SAFE for tenant-customer', () => {
    expect(getDisclosureTierForPrincipal(authPrincipal('tenant-customer'))).toBe(
      DisclosureTier.SAFE
    );
  });
  it('returns HIGH_RISK for platform-admin', () => {
    expect(getDisclosureTierForPrincipal(authPrincipal('platform-admin'))).toBe(
      DisclosureTier.HIGH_RISK
    );
  });
  it('returns NEVER for security-engineer', () => {
    expect(getDisclosureTierForPrincipal(authPrincipal('security-engineer'))).toBe(
      DisclosureTier.NEVER
    );
  });

  it('fails closed (SAFE) when source is not auth-middleware', () => {
    const spoofed = {
      id: 'attacker',
      role: 'platform-admin' as PrincipalRole,
      source: 'user-supplied' as 'auth-middleware', // forced cast — simulates attacker
    };
    expect(getDisclosureTierForPrincipal(spoofed)).toBe(DisclosureTier.SAFE);
  });

  it('fails closed (SAFE) on unknown role', () => {
    const bogus = {
      id: 'usr_x',
      role: 'super-duper-admin' as PrincipalRole,
      source: 'auth-middleware' as const,
    };
    expect(getDisclosureTierForPrincipal(bogus)).toBe(DisclosureTier.SAFE);
  });
});

describe('role-gate: getDisclosureTierWithReason', () => {
  it('reports normal resolution', () => {
    const r = getDisclosureTierWithReason(authPrincipal('platform-admin'));
    expect(r.tier).toBe(DisclosureTier.HIGH_RISK);
    expect(r.reason).toContain('platform-admin');
  });
  it('reports fail-closed when source spoofed', () => {
    const r = getDisclosureTierWithReason({
      id: 'x',
      role: 'platform-admin',
      source: 'user-supplied' as 'auth-middleware',
    });
    expect(r.reason).toMatch(/source-not-auth-middleware/);
    expect(r.tier).toBe(DisclosureTier.SAFE);
  });
  it('reports fail-closed on unknown role', () => {
    const r = getDisclosureTierWithReason({
      id: 'x',
      role: 'wizard' as PrincipalRole,
      source: 'auth-middleware',
    });
    expect(r.reason).toMatch(/unknown-role/);
  });
});

describe('role-gate: rejectUserSuppliedRoleHeaders (negative test)', () => {
  it('accepts headers with no role-spoofing names', () => {
    const r = rejectUserSuppliedRoleHeaders({
      'content-type': 'application/json',
      'user-agent': 'curl',
      cookie: 'session=abc',
    });
    expect(r.accepted).toBe(true);
    expect(r.offendingHeaders).toHaveLength(0);
  });

  it('rejects x-role header', () => {
    const r = rejectUserSuppliedRoleHeaders({ 'X-Role': 'platform-admin' });
    expect(r.accepted).toBe(false);
    expect(r.offendingHeaders).toContain('x-role');
  });

  it('rejects role, x-user-role, x-principal-role, x-rbac-role', () => {
    const r = rejectUserSuppliedRoleHeaders({
      'X-User-Role': 'platform-admin',
      'X-Principal-Role': 'platform-admin',
      'X-RBAC-Role': 'platform-admin',
      Role: 'platform-admin',
    });
    expect(r.accepted).toBe(false);
    expect(r.offendingHeaders).toHaveLength(4);
  });

  it('is case-insensitive (X-Role vs x-role both blocked)', () => {
    const r = rejectUserSuppliedRoleHeaders({ 'X-ROLE': 'admin' });
    expect(r.accepted).toBe(false);
  });
});

describe('role-gate: isKnownRole guard', () => {
  it('accepts known canonical roles', () => {
    expect(isKnownRole('tenant-customer')).toBe(true);
    expect(isKnownRole('security-engineer')).toBe(true);
  });
  it('rejects unknown / made-up roles', () => {
    expect(isKnownRole('wizard')).toBe(false);
    expect(isKnownRole('')).toBe(false);
    expect(isKnownRole('PLATFORM-ADMIN')).toBe(false); // case-sensitive
  });
});
