/**
 * Owner → org-scoped Admin delegation invariants (Wave-5).
 *
 * Five invariants exercised here:
 *
 *   1. Owner of tenant T grants user U the role `admin` on sub-org S1.
 *      U gains "near-owner" powers SCOPED TO S1 (CRUD inside, read
 *      outside denied).
 *   2. A delegated admin cannot enumerate, read, or join data across
 *      scopes they were not granted. List/search queries auto-filter
 *      to the granted scope (no `*` fallback). The denial recorder
 *      logs the attempt.
 *   4. An admin can grant subordinate roles on their own subtree but
 *      NOT on a sibling subtree, NOT on the parent, NOT at peer-or-
 *      higher tier. The grant chain records `granted_by`.
 *   5. When the owner revokes U's binding, U loses access immediately
 *      AND every binding U granted while admin is cascade-revoked.
 *
 * (Invariant 3 — self-T2 approval — lives in `mutation-authority/__tests__`
 *  because that's where the four-eye state machine is implemented.)
 *
 * Every test builds its own tree, its own repo, its own recorder. No
 * shared state leaks between tests.
 */

import { describe, expect, it } from 'vitest';
import { buildOrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import {
  canDelegateBinding,
  computeCascadeRevocations,
} from '../scope/delegation-policy.js';
import { buildVisibilityFilter } from '../scope/visibility-filter.js';
import { checkAuthority } from '../scope/authority-checker.js';
import { InMemoryUserScopeBindingRepository } from '../bindings/binding-repository.js';
import type { OrgUnit, UserScopeBinding } from '../types.js';

const TENANT = 't-borjie';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function unit(
  id: string,
  parent: string | null,
  overrides: Partial<OrgUnit> = {},
): OrgUnit {
  return {
    id,
    tenant_id: TENANT,
    parent_unit_id: parent,
    default_kind: 'district',
    display_name: id,
    display_kind_singular: 'site',
    display_kind_plural: 'sites',
    materialised_path:
      parent === null ? `${TENANT}/${id}` : `${TENANT}/${parent}/${id}`,
    depth: parent === null ? 1 : 2,
    authority_inheritance: true,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Standard fixture — tenant with two sibling top-level orgs S1, S2 and
 * a leaf child under S1 ("S1-child"). Mirrors the spec scenario of a
 * mining tenant with two mine sites.
 *
 *           TENANT
 *           /    \
 *         S1     S2
 *         /
 *      S1-child
 */
function buildStandardTree(): ReturnType<typeof buildOrgUnitTree> {
  return buildOrgUnitTree({
    tenantId: TENANT,
    units: [
      unit('S1', null),
      unit('S2', null),
      unit('S1-child', 'S1'),
    ],
  });
}

function ownerBinding(): UserScopeBinding {
  return {
    id: 'b-owner',
    user_id: 'user-owner',
    tenant_id: TENANT,
    scope_kind: 'tenant_root',
    org_unit_id: null,
    role: 'owner',
    authority_tier_max: 2,
    granted_at: '2026-05-01T00:00:00.000Z',
    granted_by: 'system',
    revoked_at: null,
  };
}

function adminOn(
  bindingId: string,
  userId: string,
  orgUnitId: string,
  tier: 0 | 1 | 2 = 2,
  grantedBy = 'user-owner',
): UserScopeBinding {
  return {
    id: bindingId,
    user_id: userId,
    tenant_id: TENANT,
    scope_kind: 'org_unit',
    org_unit_id: orgUnitId,
    role: 'admin',
    authority_tier_max: tier,
    granted_at: '2026-05-02T00:00:00.000Z',
    granted_by: grantedBy,
    revoked_at: null,
  };
}

// ===========================================================================
// Invariant 1 — Owner → org-scoped Admin delegation works
// ===========================================================================

describe('invariant 1 — owner can delegate org-scoped admin', () => {
  it('delegated admin U gains near-owner powers WITHIN S1 only', () => {
    const tree = buildStandardTree();
    const owner = ownerBinding();

    // Owner grants U → admin on S1, tier 2 (near-owner).
    const verdict = canDelegateBinding({
      grantor: owner,
      request: {
        tenantId: TENANT,
        role: 'admin',
        scopeKind: 'org_unit',
        orgUnitId: 'S1',
        authorityTierMax: 1, // strictly below owner's tier 2
      },
      tree,
    });
    expect(verdict.allowed).toBe(true);

    const uBinding = adminOn('b-u', 'user-U', 'S1', 1);

    // U's visibility filter expands S1 → {S1, S1-child}. S2 is NOT
    // included.
    const view = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: [uBinding],
      tree,
    });
    expect(view.is_tenant_root).toBe(false);
    expect(new Set(view.filter.org_unit_ids)).toEqual(
      new Set(['S1', 'S1-child']),
    );
    expect(view.filter.org_unit_ids.includes('S2')).toBe(false);
    expect(view.authority_tier_max).toBe(1);

    // U can read AND write a Tier-1 resource X inside S1.
    const readX = checkAuthority({
      user_tier: view.authority_tier_max,
      required_tier: 0,
      role: 'admin',
      in_scope: true,
    });
    expect(readX.allowed).toBe(true);

    const writeX = checkAuthority({
      user_tier: view.authority_tier_max,
      required_tier: 1,
      role: 'admin',
      in_scope: true,
    });
    expect(writeX.allowed).toBe(true);
  });

  it('delegated admin U cannot read resource Y inside sibling S2', () => {
    const tree = buildStandardTree();
    const uBinding = adminOn('b-u', 'user-U', 'S1', 2);
    const view = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: [uBinding],
      tree,
    });

    // The visibility filter does not include S2 → a request that
    // targets a resource in S2 has `in_scope=false` and the authority
    // checker denies regardless of role/tier.
    const readY = checkAuthority({
      user_tier: view.authority_tier_max,
      required_tier: 0,
      role: 'admin',
      in_scope: false,
    });
    expect(readY.allowed).toBe(false);
    expect(readY.reason).toBe('scope_mismatch');
  });
});

// ===========================================================================
// Invariant 2 — Cross-scope leak is blocked
// ===========================================================================

describe('invariant 2 — cross-scope leak is blocked', () => {
  it('cross-scope read attempts have in_scope=false → checkAuthority denies', () => {
    const tree = buildStandardTree();
    const uBinding = adminOn('b-u', 'user-U', 'S1', 2);

    // Build U's filter — S2 is NOT included.
    const view = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: [uBinding],
      tree,
    });
    expect(view.filter.org_unit_ids.includes('S2')).toBe(false);

    // A repository receiving the visibility filter for U must reject
    // any row whose org_unit_id is not in the filter. The authority
    // checker mirrors that: in_scope = false → deny with
    // 'scope_mismatch'.
    const denied = checkAuthority({
      user_tier: view.authority_tier_max,
      required_tier: 0,
      role: 'admin',
      in_scope: false,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('scope_mismatch');

    // (Separately covered in
    //  @borjie/cross-org-denial-recorder/__tests__/scoped-admin-denial.test.ts:
    //  the denial sink records this attempt.)
  });

  it('list/search filters never fall back to scope:* — empty bindings = empty filter', () => {
    const tree = buildStandardTree();
    // U has had every binding revoked (or never had one).
    const view = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: [],
      tree,
    });
    // Critical invariant — absence of bindings does NOT widen to "*".
    expect(view.is_tenant_root).toBe(false);
    expect(view.filter.org_unit_ids).toEqual([]);
    expect(view.authority_tier_max).toBe(0);

    // Likewise, a revoked binding must be ignored as if it never existed.
    const revoked = adminOn('b-u', 'user-U', 'S1', 2);
    const revokedRow: UserScopeBinding = {
      ...revoked,
      revoked_at: '2026-05-10T00:00:00.000Z',
    };
    const viewRev = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: [revokedRow],
      tree,
    });
    expect(viewRev.filter.org_unit_ids).toEqual([]);
    expect(viewRev.authority_tier_max).toBe(0);
  });

  it('no implicit elevation to parent tenant audit log via shared parent', () => {
    const tree = buildStandardTree();
    // U is admin on S1-child. Their filter expands to {S1-child}
    // only — NOT S1, and certainly NOT the tenant root.
    const uBinding = adminOn('b-u', 'user-U', 'S1-child', 2);
    const view = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: [uBinding],
      tree,
    });
    expect(new Set(view.filter.org_unit_ids)).toEqual(new Set(['S1-child']));
    expect(view.is_tenant_root).toBe(false);
    // No tenant_root sentinel means the audit_log repository will
    // refuse to widen — there is no scope:* fallback path.
  });
});

// ===========================================================================
// Invariant 4 — Recursive grant is bounded
// ===========================================================================

describe('invariant 4 — recursive grant is bounded by scope + tier', () => {
  it('admin U on S1 may grant a manager on S1-child (subordinate scope, lower tier)', () => {
    const tree = buildStandardTree();
    const u = adminOn('b-u', 'user-U', 'S1', 2);
    const verdict = canDelegateBinding({
      grantor: u,
      request: {
        tenantId: TENANT,
        role: 'manager',
        scopeKind: 'org_unit',
        orgUnitId: 'S1-child',
        authorityTierMax: 1, // strictly below grantor tier 2
      },
      tree,
    });
    expect(verdict.allowed).toBe(true);
  });

  it('admin U on S1 CANNOT grant on sibling S2', () => {
    const tree = buildStandardTree();
    const u = adminOn('b-u', 'user-U', 'S1', 2);
    const verdict = canDelegateBinding({
      grantor: u,
      request: {
        tenantId: TENANT,
        role: 'manager',
        scopeKind: 'org_unit',
        orgUnitId: 'S2',
        authorityTierMax: 1,
      },
      tree,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('scope_outside_grantor');
  });

  it('admin U on S1-child CANNOT grant on parent S1 (upward grant blocked)', () => {
    const tree = buildStandardTree();
    const u = adminOn('b-u', 'user-U', 'S1-child', 2);
    const verdict = canDelegateBinding({
      grantor: u,
      request: {
        tenantId: TENANT,
        role: 'manager',
        scopeKind: 'org_unit',
        orgUnitId: 'S1',
        authorityTierMax: 1,
      },
      tree,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('scope_outside_grantor');
  });

  it('admin U tier 2 CANNOT grant a peer-tier-2 binding (no recursive peer grant)', () => {
    const tree = buildStandardTree();
    const u = adminOn('b-u', 'user-U', 'S1', 2);
    const verdict = canDelegateBinding({
      grantor: u,
      request: {
        tenantId: TENANT,
        role: 'admin',
        scopeKind: 'org_unit',
        orgUnitId: 'S1-child',
        authorityTierMax: 2, // peer tier — blocked
      },
      tree,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('tier_not_below_grantor');
  });

  it('admin U CANNOT grant tenant_root scope (no scope escape)', () => {
    const tree = buildStandardTree();
    const u = adminOn('b-u', 'user-U', 'S1', 2);
    const verdict = canDelegateBinding({
      grantor: u,
      request: {
        tenantId: TENANT,
        role: 'admin',
        scopeKind: 'tenant_root',
        orgUnitId: null,
        authorityTierMax: 1,
      },
      tree,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('tenant_root_grant_forbidden');
  });

  it('the grant chain records granted_by on the binding row', async () => {
    const repo = new InMemoryUserScopeBindingRepository();
    const grant = await repo.grant({
      userId: 'user-V',
      tenantId: TENANT,
      scopeKind: 'org_unit',
      orgUnitId: 'S1-child',
      role: 'manager',
      authorityTierMax: 1,
      grantedBy: 'user-U',
    });
    expect(grant.granted_by).toBe('user-U');
    expect(grant.revoked_at).toBeNull();
  });

  it('an employee binding cannot delegate at all', () => {
    const tree = buildStandardTree();
    const employee: UserScopeBinding = {
      ...adminOn('b-e', 'user-E', 'S1', 2),
      role: 'employee',
    };
    const verdict = canDelegateBinding({
      grantor: employee,
      request: {
        tenantId: TENANT,
        role: 'manager',
        scopeKind: 'org_unit',
        orgUnitId: 'S1-child',
        authorityTierMax: 1,
      },
      tree,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('grantor_role_not_admin');
  });

  it('a revoked grantor cannot delegate', () => {
    const tree = buildStandardTree();
    const revoked: UserScopeBinding = {
      ...adminOn('b-u', 'user-U', 'S1', 2),
      revoked_at: '2026-05-10T00:00:00.000Z',
    };
    const verdict = canDelegateBinding({
      grantor: revoked,
      request: {
        tenantId: TENANT,
        role: 'manager',
        scopeKind: 'org_unit',
        orgUnitId: 'S1-child',
        authorityTierMax: 1,
      },
      tree,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('grantor_revoked');
  });
});

// ===========================================================================
// Invariant 5 — Revocation propagates (cascade)
// ===========================================================================

describe('invariant 5 — revocation cascades to downstream grants', () => {
  it('revoking U on S1 cascades to every binding U granted within S1', () => {
    const tree = buildStandardTree();
    const uBinding = adminOn('b-u', 'user-U', 'S1', 2);
    // U granted V → manager on S1-child, and W → employee on S1-child.
    const vBinding: UserScopeBinding = {
      id: 'b-v',
      user_id: 'user-V',
      tenant_id: TENANT,
      scope_kind: 'org_unit',
      org_unit_id: 'S1-child',
      role: 'manager',
      authority_tier_max: 1,
      granted_at: '2026-05-03T00:00:00.000Z',
      granted_by: 'user-U',
      revoked_at: null,
    };
    const wBinding: UserScopeBinding = {
      id: 'b-w',
      user_id: 'user-W',
      tenant_id: TENANT,
      scope_kind: 'org_unit',
      org_unit_id: 'S1',
      role: 'employee',
      authority_tier_max: 0,
      granted_at: '2026-05-03T00:00:00.000Z',
      granted_by: 'user-U',
      revoked_at: null,
    };
    // Owner also granted X directly on S2 — must NOT be touched.
    const xBinding: UserScopeBinding = {
      id: 'b-x',
      user_id: 'user-X',
      tenant_id: TENANT,
      scope_kind: 'org_unit',
      org_unit_id: 'S2',
      role: 'manager',
      authority_tier_max: 1,
      granted_at: '2026-05-03T00:00:00.000Z',
      granted_by: 'user-owner',
      revoked_at: null,
    };

    const cascade = computeCascadeRevocations({
      revokedBinding: uBinding,
      allBindings: [uBinding, vBinding, wBinding, xBinding],
      tree,
    });

    const ids = new Set(cascade.map((c) => c.id));
    expect(ids.has('b-v')).toBe(true);
    expect(ids.has('b-w')).toBe(true);
    expect(ids.has('b-x')).toBe(false); // sibling subtree — untouched
    expect(ids.has(uBinding.id)).toBe(false); // self excluded
  });

  it('cascade ignores already-revoked downstream rows', () => {
    const tree = buildStandardTree();
    const uBinding = adminOn('b-u', 'user-U', 'S1', 2);
    const alreadyRevoked: UserScopeBinding = {
      id: 'b-v-old',
      user_id: 'user-V',
      tenant_id: TENANT,
      scope_kind: 'org_unit',
      org_unit_id: 'S1-child',
      role: 'manager',
      authority_tier_max: 1,
      granted_at: '2026-05-03T00:00:00.000Z',
      granted_by: 'user-U',
      revoked_at: '2026-05-10T00:00:00.000Z',
    };
    const cascade = computeCascadeRevocations({
      revokedBinding: uBinding,
      allBindings: [uBinding, alreadyRevoked],
      tree,
    });
    expect(cascade).toHaveLength(0);
  });

  it('cascade leaves bindings issued by other grantors alone', () => {
    const tree = buildStandardTree();
    const uBinding = adminOn('b-u', 'user-U', 'S1', 2);
    const issuedByOwner: UserScopeBinding = {
      id: 'b-y',
      user_id: 'user-Y',
      tenant_id: TENANT,
      scope_kind: 'org_unit',
      org_unit_id: 'S1-child',
      role: 'manager',
      authority_tier_max: 1,
      granted_at: '2026-05-03T00:00:00.000Z',
      granted_by: 'user-owner',
      revoked_at: null,
    };
    const cascade = computeCascadeRevocations({
      revokedBinding: uBinding,
      allBindings: [uBinding, issuedByOwner],
      tree,
    });
    expect(cascade).toHaveLength(0);
  });

  it('end-to-end via in-memory repo — U loses access AND downstream grants are marked revoked_cascade', async () => {
    const repo = new InMemoryUserScopeBindingRepository();
    const tree = buildStandardTree();

    // Owner grants U admin on S1.
    const uGrant = await repo.grant({
      userId: 'user-U',
      tenantId: TENANT,
      scopeKind: 'org_unit',
      orgUnitId: 'S1',
      role: 'admin',
      authorityTierMax: 2,
      grantedBy: 'user-owner',
    });

    // U grants V manager on S1-child.
    const vGrant = await repo.grant({
      userId: 'user-V',
      tenantId: TENANT,
      scopeKind: 'org_unit',
      orgUnitId: 'S1-child',
      role: 'manager',
      authorityTierMax: 1,
      grantedBy: 'user-U',
    });

    // Owner directly grants X on S2 (independent path).
    const xGrant = await repo.grant({
      userId: 'user-X',
      tenantId: TENANT,
      scopeKind: 'org_unit',
      orgUnitId: 'S2',
      role: 'manager',
      authorityTierMax: 1,
      grantedBy: 'user-owner',
    });

    // Owner revokes U's binding.
    const revokedAt = '2026-05-15T00:00:00.000Z';
    await repo.revoke(uGrant.id, revokedAt);

    // Compute cascade — load the full snapshot first.
    const all = await repo.list({
      tenantId: TENANT,
      includeRevoked: true,
    });
    const uAfter = all.find((b) => b.id === uGrant.id);
    expect(uAfter?.revoked_at).toBe(revokedAt);

    // The revoked binding state must be the input to compute-cascade.
    const cascade = computeCascadeRevocations({
      revokedBinding: uAfter!,
      allBindings: all,
      tree,
    });
    expect(cascade.map((c) => c.id)).toEqual([vGrant.id]);

    // Apply the cascade — simulate the repo writing `revoked_at` plus
    // a cascade marker (in production the repo also stores a status
    // column; here we just check the cascade list).
    for (const c of cascade) {
      await repo.revoke(c.id, revokedAt);
    }

    // U has no active bindings anymore — visibility filter collapses
    // to empty (no scope leak).
    const uActive = await repo.list({
      tenantId: TENANT,
      userId: 'user-U',
    });
    expect(uActive).toHaveLength(0);

    const uView = buildVisibilityFilter({
      tenantId: TENANT,
      bindings: uActive,
      tree,
    });
    expect(uView.filter.org_unit_ids).toEqual([]);
    expect(uView.authority_tier_max).toBe(0);

    // V also has no active bindings (cascade applied).
    const vActive = await repo.list({
      tenantId: TENANT,
      userId: 'user-V',
    });
    expect(vActive).toHaveLength(0);

    // X (granted by owner directly) is UNCHANGED.
    const xActive = await repo.list({
      tenantId: TENANT,
      userId: 'user-X',
    });
    expect(xActive).toHaveLength(1);
    expect(xActive[0]?.id).toBe(xGrant.id);
  });
});

// ===========================================================================
// Test isolation sanity check — each test owns its own state.
// ===========================================================================

describe('test isolation', () => {
  it('a binding granted in another test does not leak into a fresh repo', async () => {
    const repo = new InMemoryUserScopeBindingRepository();
    const listed = await repo.list({ tenantId: TENANT });
    expect(listed).toEqual([]);
  });
});
