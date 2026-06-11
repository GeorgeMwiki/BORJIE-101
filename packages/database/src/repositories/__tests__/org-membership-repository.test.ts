/**
 * OrgMembershipRepository tests (in-memory twin) — the WRITE-PATH + targeting
 * reads for the User⟷Membership⟷Org substrate (surface-completion SC-1).
 *
 * Covers the store invariants that hold regardless of backend:
 *   - connect persists + round-trips a fresh ACTIVE membership with its
 *     relationship_type + member_role targeting label;
 *   - connect is idempotent on (identity, org): re-connecting REACTIVATES a LEFT
 *     row (one row per pair, the unique-index model) and never duplicates;
 *   - a BLOCKED membership is NOT silently reactivated by connect — the blocked
 *     row is returned unchanged so the caller refuses;
 *   - redeemInvite atomically consumes a live invite into a membership; an
 *     expired / revoked / exhausted invite throws InviteRedemptionError;
 *   - redeemInvite respects maxRedemptions (the N+1th redeem is rejected);
 *   - listActiveForIdentity returns ONLY ACTIVE memberships, across orgs (the
 *     multi-org JWT / switcher SET); a LEFT membership drops out;
 *   - verifyActiveMembership is the switch authorization (ACTIVE only);
 *   - resolveAudience fans ACTIVE memberships by relationship_type + role-class;
 *   - leave → LEFT (ACTIVE-only, idempotent); block → BLOCKED (org-scoped).
 *
 * The Drizzle twin shares this exact surface; its RLS isolation is enforced by
 * migration 0336's FORCE policy + 0344's columns (covered by migration-apply).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryOrgMembershipRepository,
  InviteRedemptionError,
} from '../org-membership.repository.js';

const baseConnect = {
  tenantIdentityId: 'ident_1',
  organizationId: 'org_A',
  platformTenantId: 'tenant_A',
  userId: 'user_A1',
  relationshipType: 'employment' as const,
  memberRole: 'safety_officer',
};

describe('OrgMembershipRepository (in-memory twin)', () => {
  it('connect persists a fresh ACTIVE membership and round-trips it', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const m = await repo.connect(baseConnect);
    expect(m.status).toBe('ACTIVE');
    expect(m.organizationId).toBe('org_A');
    expect(m.relationshipType).toBe('employment');
    expect(m.memberRole).toBe('safety_officer');
    expect(m.id).toMatch(/^mem_/);
    expect(m.leftAtMs).toBeNull();
    expect(m.blockedAtMs).toBeNull();
  });

  it('connect is idempotent on (identity, org) — reactivates a LEFT row, never duplicates', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const first = await repo.connect(baseConnect);
    await repo.leave('ident_1', 'org_A');
    expect(await repo.verifyActiveMembership('ident_1', 'org_A')).toBeNull();

    const reconnected = await repo.connect({
      ...baseConnect,
      relationshipType: 'contractor',
      memberRole: 'driller',
    });
    expect(reconnected.id).toBe(first.id); // SAME row (unique on pair)
    expect(reconnected.status).toBe('ACTIVE');
    expect(reconnected.relationshipType).toBe('contractor');
    expect(reconnected.memberRole).toBe('driller');
    expect(reconnected.leftAtMs).toBeNull();

    const active = await repo.listActiveForIdentity('ident_1');
    expect(active).toHaveLength(1); // not duplicated
  });

  it('connect does NOT silently reactivate a BLOCKED membership', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const m = await repo.connect(baseConnect);
    await repo.block({ organizationId: 'org_A', membershipId: m.id, reason: 'fraud' });

    const afterConnect = await repo.connect(baseConnect);
    expect(afterConnect.status).toBe('BLOCKED'); // unchanged, caller must refuse
    expect(await repo.verifyActiveMembership('ident_1', 'org_A')).toBeNull();
  });

  it('redeemInvite atomically consumes a live invite into a membership', async () => {
    const repo = createInMemoryOrgMembershipRepository({
      invites: [
        {
          code: 'INV-LIVE',
          organizationId: 'org_B',
          platformTenantId: 'tenant_B',
          defaultRoleId: 'hauler',
          maxRedemptions: 2,
        },
      ],
    });
    const result = await repo.redeemInvite({
      code: 'INV-LIVE',
      tenantIdentityId: 'ident_2',
      userId: 'user_B1',
      relationshipType: 'employment',
    });
    expect(result.organizationId).toBe('org_B');
    expect(result.platformTenantId).toBe('tenant_B');
    expect(result.membership.status).toBe('ACTIVE');
    // member_role is the invite's default role (a targeting label).
    expect(result.membership.memberRole).toBe('hauler');
    expect(result.membership.joinedViaInviteCode).toBe('INV-LIVE');
  });

  it('redeemInvite rejects an expired / revoked / unknown invite', async () => {
    const past = new Date(Date.now() - 60_000);
    const repo = createInMemoryOrgMembershipRepository({
      invites: [
        { code: 'INV-EXPIRED', organizationId: 'o', platformTenantId: 't', defaultRoleId: 'r', expiresAt: past },
        { code: 'INV-REVOKED', organizationId: 'o', platformTenantId: 't', defaultRoleId: 'r', revokedAt: new Date() },
      ],
    });
    await expect(
      repo.redeemInvite({ code: 'INV-EXPIRED', tenantIdentityId: 'i', userId: 'u' }),
    ).rejects.toBeInstanceOf(InviteRedemptionError);
    await expect(
      repo.redeemInvite({ code: 'INV-REVOKED', tenantIdentityId: 'i', userId: 'u' }),
    ).rejects.toBeInstanceOf(InviteRedemptionError);
    await expect(
      repo.redeemInvite({ code: 'INV-UNKNOWN', tenantIdentityId: 'i', userId: 'u' }),
    ).rejects.toBeInstanceOf(InviteRedemptionError);
  });

  it('redeemInvite respects maxRedemptions (the N+1th redeem is rejected)', async () => {
    const repo = createInMemoryOrgMembershipRepository({
      invites: [
        { code: 'INV-ONE', organizationId: 'org_C', platformTenantId: 'tenant_C', defaultRoleId: 'r', maxRedemptions: 1 },
      ],
    });
    await repo.redeemInvite({ code: 'INV-ONE', tenantIdentityId: 'ident_X', userId: 'user_X' });
    // A DIFFERENT identity tries the now-exhausted invite.
    await expect(
      repo.redeemInvite({ code: 'INV-ONE', tenantIdentityId: 'ident_Y', userId: 'user_Y' }),
    ).rejects.toBeInstanceOf(InviteRedemptionError);
  });

  it('listActiveForIdentity returns ACTIVE memberships across orgs; LEFT drops out', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    await repo.connect(baseConnect); // org_A
    await repo.connect({
      ...baseConnect,
      organizationId: 'org_D',
      platformTenantId: 'tenant_D',
      userId: 'user_D1',
      relationshipType: 'buyer_connection',
      memberRole: null,
    });
    expect(await repo.listActiveForIdentity('ident_1')).toHaveLength(2);

    await repo.leave('ident_1', 'org_A');
    const active = await repo.listActiveForIdentity('ident_1');
    expect(active).toHaveLength(1);
    expect(active[0]?.organizationId).toBe('org_D');
  });

  it('resolveAudience fans ACTIVE memberships by relationship_type and role-class', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    await repo.connect({ ...baseConnect, tenantIdentityId: 'w1', userId: 'u1', memberRole: 'safety_officer' });
    await repo.connect({ ...baseConnect, tenantIdentityId: 'w2', userId: 'u2', memberRole: 'safety_officer' });
    await repo.connect({ ...baseConnect, tenantIdentityId: 'w3', userId: 'u3', memberRole: 'driller' });
    await repo.connect({
      ...baseConnect,
      tenantIdentityId: 'b1',
      userId: 'ub1',
      relationshipType: 'buyer_connection',
      memberRole: null,
    });

    // All connected buyers.
    const buyers = await repo.resolveAudience('org_A', { relationshipType: 'buyer_connection' });
    expect(buyers.map((m) => m.tenantIdentityId)).toEqual(['b1']);

    // All safety officers (role-class fan).
    const officers = await repo.resolveAudience('org_A', {
      relationshipType: 'employment',
      memberRoles: ['safety_officer'],
    });
    expect(officers.map((m) => m.tenantIdentityId).sort()).toEqual(['w1', 'w2']);

    // No predicate = every ACTIVE member of the org.
    const everyone = await repo.resolveAudience('org_A');
    expect(everyone).toHaveLength(4);
  });

  it('leave is ACTIVE-only and idempotent; block is org-scoped', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const m = await repo.connect(baseConnect);

    const left = await repo.leave('ident_1', 'org_A');
    expect(left?.status).toBe('LEFT');
    expect(left?.leftAtMs).not.toBeNull();
    // second leave finds no ACTIVE row.
    expect(await repo.leave('ident_1', 'org_A')).toBeNull();

    // block a membership in the WRONG org → no-op (org-scoped).
    expect(
      await repo.block({ organizationId: 'org_OTHER', membershipId: m.id, reason: 'x' }),
    ).toBeNull();
  });

  it('asserts non-empty keys (defence-in-depth against service-role over-reads)', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    await expect(repo.listActiveForIdentity('')).rejects.toThrow(/tenantIdentityId/);
    await expect(repo.resolveAudience('')).rejects.toThrow(/organizationId/);
    await expect(
      repo.connect({ ...baseConnect, userId: '' }),
    ).rejects.toThrow(/userId/);
  });
});
