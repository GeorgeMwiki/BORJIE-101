import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  RISK_TIERS_ORDERED,
  assertHqToolSpecValid,
  callerCanReachTenant,
  callerHasAllScopes,
  callerHasAnyScope,
  compareRiskTier,
  isSovereignTier,
  requiresCostCeiling,
  scopeMatches,
  type HqToolSpec,
} from '../../../risk-tier.js';

describe('risk-tier helpers', () => {
  it('RISK_TIERS_ORDERED is the canonical order', () => {
    expect(RISK_TIERS_ORDERED).toEqual([
      'read',
      'mutate',
      'destroy',
      'billing',
      'external-comm',
    ]);
  });

  it('compareRiskTier — read < mutate < destroy < billing < external-comm', () => {
    expect(compareRiskTier('read', 'mutate')).toBe(-1);
    expect(compareRiskTier('mutate', 'mutate')).toBe(0);
    expect(compareRiskTier('billing', 'destroy')).toBe(1);
  });

  it('isSovereignTier — destroy/billing/external-comm are sovereign', () => {
    expect(isSovereignTier('read')).toBe(false);
    expect(isSovereignTier('mutate')).toBe(false);
    expect(isSovereignTier('destroy')).toBe(true);
    expect(isSovereignTier('billing')).toBe(true);
    expect(isSovereignTier('external-comm')).toBe(true);
  });

  it('requiresCostCeiling — only billing today', () => {
    expect(requiresCostCeiling('billing')).toBe(true);
    expect(requiresCostCeiling('destroy')).toBe(false);
    expect(requiresCostCeiling('external-comm')).toBe(false);
  });

  it('scopeMatches — wildcard covers prefix', () => {
    expect(scopeMatches('platform:*', 'platform:tenants:write')).toBe(true);
    expect(scopeMatches('platform:*', 'tenant:foo')).toBe(false);
    expect(scopeMatches('exact', 'exact')).toBe(true);
  });

  it('callerHasAnyScope returns true for wildcard hit', () => {
    expect(
      callerHasAnyScope(
        { callerId: 'x', scopes: ['platform:*'] },
        ['platform:tenants:write'],
      ),
    ).toBe(true);
  });

  it('callerHasAllScopes returns false when any required missing', () => {
    expect(
      callerHasAllScopes(
        { callerId: 'x', scopes: ['platform:billing:write'] },
        ['platform:billing:write', 'platform:ops:write'],
      ),
    ).toBe(false);
  });

  it('callerCanReachTenant — platform admin reaches all', () => {
    expect(
      callerCanReachTenant(
        { callerId: 'x', scopes: ['platform:admin'] },
        't-alpha',
      ),
    ).toBe(true);
  });

  it('callerCanReachTenant — tenant-scoped caller only own tenants', () => {
    const caller = {
      callerId: 'x',
      scopes: ['tenant:t-alpha', 'tenant:t-alpha:owner'],
    };
    expect(callerCanReachTenant(caller, 't-alpha')).toBe(true);
    expect(callerCanReachTenant(caller, 't-beta')).toBe(false);
  });

  it('assertHqToolSpecValid — mutate tool MUST define rollback', () => {
    const bad = {
      name: 'platform.bad',
      riskTier: 'mutate',
      description: 'x',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      requiredScopes: [],
      approvalRequired: false,
      async execute() {
        return { kind: 'ok', output: {} } as const;
      },
    } as unknown as HqToolSpec;
    expect(() => assertHqToolSpecValid(bad)).toThrow(/MUST define rollback/);
  });

  it('assertHqToolSpecValid — destroy tool MUST require approval', () => {
    const bad = {
      name: 'platform.bad',
      riskTier: 'destroy',
      description: 'x',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      requiredScopes: [],
      approvalRequired: false,
      rollback: async () => undefined,
      async execute() {
        return { kind: 'ok', output: {} } as const;
      },
    } as unknown as HqToolSpec;
    expect(() => assertHqToolSpecValid(bad)).toThrow(/MUST require approval/);
  });

  it('assertHqToolSpecValid — billing tool MUST declare costEstimateUsd', () => {
    const bad = {
      name: 'platform.bad',
      riskTier: 'billing',
      description: 'x',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      requiredScopes: [],
      approvalRequired: true,
      rollback: async () => undefined,
      async execute() {
        return { kind: 'ok', output: {} } as const;
      },
    } as unknown as HqToolSpec;
    expect(() => assertHqToolSpecValid(bad)).toThrow(/MUST declare costEstimateUsd/);
  });

  it('assertHqToolSpecValid — name must start with platform.', () => {
    const bad = {
      name: 'agency.something',
      riskTier: 'read',
      description: 'x',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      requiredScopes: [],
      approvalRequired: false,
      async execute() {
        return { kind: 'ok', output: {} } as const;
      },
    } as unknown as HqToolSpec;
    expect(() => assertHqToolSpecValid(bad)).toThrow(/must start with "platform\."/);
  });
});
