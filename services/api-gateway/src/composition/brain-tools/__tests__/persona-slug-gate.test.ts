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

/**
 * REGRESSION — persona lockout on the RAW auth-token dialect.
 *
 * The orchestrator callsite (index.ts) feeds `ctx.actor.roles` = the RAW
 * Supabase `app_metadata.roles[]` tokens (`admin`, `super_admin`,
 * `borjie_team`, `support`, `site_manager`, …), the same tokens the auth
 * middleware's `ROLE_PRIORITY` table keys on. A prior fix narrowed the matcher
 * to the mapped RBAC-name dialect ONLY, so those raw tokens matched nothing and
 * every REAL admin / super-admin / site-manager was silently downgraded to the
 * least-privileged `T5_customer_concierge` — locked out of their own tools.
 * These cases are RED against that narrowed matcher, GREEN now — WITHOUT
 * re-opening the fail-closed default for a genuinely unknown role.
 */
describe('resolvePersonaSlugFromActor (raw auth-token dialect, no lockout)', () => {
  it('resolves a real ADMIN / SUPER_ADMIN / BORJIE_TEAM / SUPPORT caller to T2 (not T5)', () => {
    for (const token of ['admin', 'super_admin', 'borjie_team', 'support']) {
      expect(resolvePersonaSlugFromActor({ roles: [token] })).toBe(
        'T2_admin_strategist',
      );
    }
  });

  it('resolves a real SITE_MANAGER / PROPERTY_MANAGER caller to the manager tier (not T5)', () => {
    expect(resolvePersonaSlugFromActor({ roles: ['site_manager'] })).toBe(
      'T3_module_manager',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['property_manager'] })).toBe(
      'T3_module_manager',
    );
  });

  it('resolves raw field-worker tokens (maintenance / driver) to T4', () => {
    expect(resolvePersonaSlugFromActor({ roles: ['maintenance'] })).toBe(
      'T4_field_employee',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['driver'] })).toBe(
      'T4_field_employee',
    );
  });

  it('resolves raw buyer / resident tokens to T5', () => {
    for (const token of [
      'buyer',
      'buyer_org_admin',
      'buyer_org_member',
      'resident',
    ]) {
      expect(resolvePersonaSlugFromActor({ roles: [token] })).toBe(
        'T5_customer_concierge',
      );
    }
  });

  it('STILL fails closed to T5 for a genuinely unknown / role-less non-owner', () => {
    // The fix must NOT re-open the fail-open hole — an unmapped token is T5.
    expect(resolvePersonaSlugFromActor({ roles: ['klingon'] })).toBe(
      'T5_customer_concierge',
    );
    expect(resolvePersonaSlugFromActor({ roles: ['mining_role'] })).toBe(
      'T5_customer_concierge',
    );
    expect(resolvePersonaSlugFromActor({})).toBe('T5_customer_concierge');
  });

  it('gives the highest AUTHORIZED persona across mixed raw tokens', () => {
    // A support+admin caller who also has a buyer grant resolves to T2, and an
    // admin who also holds owner resolves to owner tier.
    expect(
      resolvePersonaSlugFromActor({ roles: ['buyer', 'admin'] }),
    ).toBe('T2_admin_strategist');
    expect(
      resolvePersonaSlugFromActor({ roles: ['admin', 'owner'] }),
    ).toBe('T1_owner_strategist');
    expect(
      resolvePersonaSlugFromActor({ roles: ['driver', 'site_manager'] }),
    ).toBe('T3_module_manager');
  });
});
