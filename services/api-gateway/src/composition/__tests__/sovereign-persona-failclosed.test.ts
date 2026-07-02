/**
 * sovereign persona-gate fail-closed regression.
 *
 * Vertical-BFLA class sibling of the primary persona gate: the cached-brain
 * `SovereignRole` -> RBAC role mapping that feeds the orchestrator persona gate
 * (`resolvePersonaSlug`) must NOT default a role-less / unrecognized scope to
 * the owner tier. A role-less scope binds the least-privileged RBAC role
 * (`CUSTOMER`) so `resolvePersonaSlug` resolves to `T5_customer_concierge`.
 */

import { describe, it, expect } from 'vitest';
import { rbacRoleForSovereignRole } from '../sovereign';

describe('sovereign persona-gate fail-closed', () => {
  it('FAILS CLOSED: a role-less (undefined) scope binds the least-privileged RBAC role, never OWNER', () => {
    const rbac = rbacRoleForSovereignRole(undefined);
    expect(rbac).toBe('CUSTOMER');
    expect(rbac).not.toBe('OWNER');
  });

  it('FAILS CLOSED: an unrecognized role binds the least-privileged RBAC role, never OWNER', () => {
    const rbac = rbacRoleForSovereignRole(
      'ghost' as unknown as Parameters<typeof rbacRoleForSovereignRole>[0],
    );
    expect(rbac).toBe('CUSTOMER');
    expect(rbac).not.toBe('OWNER');
  });

  it('keeps legitimate owner access working', () => {
    expect(rbacRoleForSovereignRole('owner')).toBe('OWNER');
  });

  it('preserves the deliberate tenant->owner brain-chat default surface', () => {
    // The `tenant` role is an EXPLICIT, intentional owner-catalog mapping
    // (matches index.ts + persona-kernel-bridge). Only the role-LESS default
    // fails closed.
    expect(rbacRoleForSovereignRole('tenant')).toBe('OWNER');
  });

  it('maps manager + admin roles unchanged', () => {
    expect(rbacRoleForSovereignRole('manager')).toBe('MANAGER');
    expect(rbacRoleForSovereignRole('org-admin')).toBe('PLATFORM_ADMIN');
    expect(rbacRoleForSovereignRole('sovereign')).toBe('PLATFORM_ADMIN');
  });
});
