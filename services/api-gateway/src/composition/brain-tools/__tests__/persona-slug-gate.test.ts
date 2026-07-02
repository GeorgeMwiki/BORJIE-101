/**
 * persona-slug-gate tests — the persona-tool authorization gate's slug
 * resolver (vertical BFLA barrier).
 *
 * The security invariant under test: a caller whose role cannot be resolved
 * from the AUTH-derived role set is bounded to the LEAST-privileged persona
 * (`T5_customer_concierge`), NEVER the owner-tier `T1_owner_strategist`. The
 * prior gate read a non-existent `actor.role` (singular) and fell OPEN to T1
 * for every caller — this test is RED against that behaviour, GREEN now.
 */

import { describe, it, expect } from 'vitest';
import { resolvePersonaSlugFromActor } from '../persona-slug-gate';

describe('resolvePersonaSlugFromActor (fail-closed persona gate)', () => {
  it('fails CLOSED to the least-privileged persona for a role-less actor', () => {
    // RED before the fix: the old gate read `actor.role` and returned
    // 'T1_owner_strategist' here.
    expect(resolvePersonaSlugFromActor(undefined)).toBe('T5_customer_concierge');
    expect(resolvePersonaSlugFromActor({})).toBe('T5_customer_concierge');
    expect(resolvePersonaSlugFromActor({ roles: [] })).toBe(
      'T5_customer_concierge',
    );
  });

  it('does NOT resolve a non-owner caller to the owner strategist', () => {
    expect(resolvePersonaSlugFromActor({ roles: ['CUSTOMER'] })).not.toBe(
      'T1_owner_strategist',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['EMPLOYEE'] })).not.toBe(
      'T1_owner_strategist',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['unknown-role'] })).toBe(
      'T5_customer_concierge',
    );
  });

  it('resolves from the canonical `roles` array (the real AIActor field)', () => {
    expect(resolvePersonaSlugFromActor({ roles: ['OWNER'] })).toBe(
      'T1_owner_strategist',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['TENANT_ADMIN'] })).toBe(
      'T2_admin_strategist',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['PLATFORM_ADMIN'] })).toBe(
      'T2_admin_strategist',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['MANAGER'] })).toBe(
      'T3_module_manager',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['WORKER'] })).toBe(
      'T4_field_employee',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['BUYER'] })).toBe(
      'T5_customer_concierge',
    );
  });

  it('still honors the back-compat structural `role` field (bridge path)', () => {
    expect(resolvePersonaSlugFromActor({ role: 'OWNER' })).toBe(
      'T1_owner_strategist',
    );
    expect(resolvePersonaSlugFromActor({ role: 'MANAGER' })).toBe(
      'T3_module_manager',
    );
  });

  it('is case-insensitive on role tokens', () => {
    expect(resolvePersonaSlugFromActor({ roles: ['owner'] })).toBe(
      'T1_owner_strategist',
    );
    expect(resolvePersonaSlugFromActor({ role: 'manager' })).toBe(
      'T3_module_manager',
    );
  });

  it('gives the highest AUTHORIZED persona when a caller holds several roles', () => {
    expect(
      resolvePersonaSlugFromActor({ roles: ['EMPLOYEE', 'OWNER'] }),
    ).toBe('T1_owner_strategist');
    expect(
      resolvePersonaSlugFromActor({ roles: ['CUSTOMER', 'MANAGER'] }),
    ).toBe('T3_module_manager');
  });

  it('ignores non-string entries in the roles array without throwing', () => {
    expect(
      resolvePersonaSlugFromActor({ roles: [null, 42, { x: 1 }, 'OWNER'] }),
    ).toBe('T1_owner_strategist');
    expect(resolvePersonaSlugFromActor({ roles: [null, 42] })).toBe(
      'T5_customer_concierge',
    );
  });
});
