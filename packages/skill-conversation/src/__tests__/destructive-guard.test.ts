/**
 * Destructive-tool blocklist + tenant-authority guard tests.
 */

import { describe, expect, it } from 'vitest';
import { SCOPE_POLICY, validateScopePolicy } from '../compile/destructive-guard.js';
import { ARREARS_CHASE_AOP, UNGUARDED_EVICTION_AOP, WEEKLY_BRIEF_AOP } from './_helpers.js';
import type { AOP } from '@borjie/aop-compiler';

describe('validateScopePolicy — owner-customer', () => {
  it('allows a non-destructive AOP', () => {
    const errors = validateScopePolicy(WEEKLY_BRIEF_AOP, 'owner-customer');
    expect(errors.length).toBe(0);
  });

  it('allows a destructive tool when ask-owner guards it', () => {
    const errors = validateScopePolicy(ARREARS_CHASE_AOP, 'owner-customer');
    expect(errors.length).toBe(0);
  });

  it('blocks an unguarded eviction', () => {
    const errors = validateScopePolicy(UNGUARDED_EVICTION_AOP, 'owner-customer');
    expect(errors.some((e) => e.code === 'tenant-authority-unguarded')).toBe(true);
  });

  it('blocks platform-admin-only tools', () => {
    const aop: AOP = {
      name: 'oc-platform-attempt',
      version: '0.1.0',
      trigger: { kind: 'manual' },
      steps: [
        {
          kind: 'tool',
          id: 'do',
          tool: 'platform.disable_tenant',
          args: {},
        },
      ],
      entry: 'do',
    };
    const errors = validateScopePolicy(aop, 'owner-customer');
    expect(errors.some((e) => e.code === 'scope-forbidden-tool')).toBe(true);
  });
});

describe('validateScopePolicy — internal-admin', () => {
  it('allows platform-admin tools (forbidden only for owner-customer)', () => {
    const aop: AOP = {
      name: 'admin-cap-tweak',
      version: '0.1.0',
      trigger: { kind: 'manual' },
      steps: [
        {
          kind: 'tool',
          id: 'tweak',
          tool: 'platform.update_autonomy_cap',
          args: {},
        },
      ],
      entry: 'tweak',
    };
    const errors = validateScopePolicy(aop, 'internal-admin');
    expect(errors.some((e) => e.code === 'scope-forbidden-tool')).toBe(false);
  });

  it('still requires ask-owner for tenant-authority tools (admin cannot bypass)', () => {
    const errors = validateScopePolicy(UNGUARDED_EVICTION_AOP, 'internal-admin');
    expect(errors.some((e) => e.code === 'tenant-authority-unguarded')).toBe(true);
  });

  it('allows tenant-authority tools when guarded', () => {
    const errors = validateScopePolicy(ARREARS_CHASE_AOP, 'internal-admin');
    expect(errors.length).toBe(0);
  });
});

describe('SCOPE_POLICY introspection', () => {
  it('exposes the owner-customer forbidden list', () => {
    expect(SCOPE_POLICY.ownerCustomerForbidden).toContain('platform.disable_tenant');
  });

  it('exposes the tenant-authority list', () => {
    expect(SCOPE_POLICY.tenantAuthority).toContain('notice.draft_eviction_notice');
  });
});
