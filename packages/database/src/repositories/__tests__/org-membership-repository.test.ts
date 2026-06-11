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
 * Plus the CORRECTED BUYER MODEL + pairing state machine (0345):
 *   - buyer_connection never carries a shadow userId (forbidden both ways);
 *   - redeemInvite derives the relationship from the INVITE (trust-direction);
 *   - request → PENDING → approve/reject; revoke; re-request; queue ordering.
 *
 * The Drizzle twin shares this exact surface; its RLS isolation is enforced by
 * migration 0336's FORCE policy + 0344/0345's columns (covered by
 * migration-apply).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryOrgMembershipRepository,
  InviteRedemptionError,
  MembershipInvariantError,
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
      userId: null, // buyers never carry a shadow user (corrected model)
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
      userId: null, // corrected buyer model
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

describe('corrected buyer model (0345) — buyer ≠ tenant-insider', () => {
  it('connect FORBIDS a shadow userId on a buyer_connection', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    await expect(
      repo.connect({
        ...baseConnect,
        relationshipType: 'buyer_connection',
        userId: 'user_A1',
      }),
    ).rejects.toBeInstanceOf(MembershipInvariantError);
  });

  it('connect REQUIRES a shadow userId on an ACTIVE employment membership', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    await expect(
      repo.connect({ ...baseConnect, userId: null }),
    ).rejects.toBeInstanceOf(MembershipInvariantError);
  });

  it('a connected buyer round-trips with userId NULL', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const buyer = await repo.connect({
      ...baseConnect,
      relationshipType: 'buyer_connection',
      memberRole: 'buyer',
      userId: null,
    });
    expect(buyer.status).toBe('ACTIVE');
    expect(buyer.userId).toBeNull();
  });

  it('redeemInvite derives the relationship from the INVITE (trust-direction fix)', async () => {
    const repo = createInMemoryOrgMembershipRepository({
      invites: [
        {
          code: 'INV-BUYER',
          organizationId: 'org_B',
          platformTenantId: 'tenant_B',
          defaultRoleId: 'buyer',
          relationshipType: 'buyer_connection',
        },
      ],
    });
    // A redeemer supplying a shadow userId against a BUYER invite is the
    // attack the fix closes: the invite's relationship wins and the shadow
    // user is refused.
    await expect(
      repo.redeemInvite({
        code: 'INV-BUYER',
        tenantIdentityId: 'ident_b',
        userId: 'smuggled_insider_user',
      }),
    ).rejects.toBeInstanceOf(MembershipInvariantError);

    const result = await repo.redeemInvite({
      code: 'INV-BUYER',
      tenantIdentityId: 'ident_b',
    });
    expect(result.membership.relationshipType).toBe('buyer_connection');
    expect(result.membership.userId).toBeNull();
  });

  it('peekInvite exposes org/tenant/relationship + liveness without consuming', async () => {
    const repo = createInMemoryOrgMembershipRepository({
      invites: [
        {
          code: 'INV-PEEK',
          organizationId: 'org_P',
          platformTenantId: 'tenant_P',
          defaultRoleId: 'hauler',
          maxRedemptions: 1,
        },
      ],
    });
    const peek = await repo.peekInvite('INV-PEEK');
    expect(peek?.organizationId).toBe('org_P');
    expect(peek?.relationshipType).toBe('employment');
    expect(peek?.redeemable).toBe(true);
    expect(await repo.peekInvite('INV-NOPE')).toBeNull();

    await repo.redeemInvite({
      code: 'INV-PEEK',
      tenantIdentityId: 'i1',
      userId: 'u1',
    });
    expect((await repo.peekInvite('INV-PEEK'))?.redeemable).toBe(false);
  });
});

describe('pairing state machine (0345) — mode (b) public discovery', () => {
  const requestBase = {
    tenantIdentityId: 'ident_req',
    organizationId: 'org_A',
    platformTenantId: 'tenant_A',
    relationshipType: 'employment' as const,
    requestedNote: 'I drill.',
  };

  it('request → PENDING with NO shadow user; approve provisions it → ACTIVE', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const pending = await repo.requestPairing(requestBase);
    expect(pending.status).toBe('PENDING');
    expect(pending.userId).toBeNull(); // never provisioned before approval
    expect(pending.requestedNote).toBe('I drill.');
    // PENDING is not ACTIVE — invisible to switch auth + audience fan.
    expect(await repo.verifyActiveMembership('ident_req', 'org_A')).toBeNull();
    expect(await repo.resolveAudience('org_A')).toHaveLength(0);

    // Employment approval REQUIRES the shadow user provisioned by the route.
    await expect(
      repo.approve({
        organizationId: 'org_A',
        membershipId: pending.id,
        decidedBy: 'owner_user',
      }),
    ).rejects.toBeInstanceOf(MembershipInvariantError);

    const approved = await repo.approve({
      organizationId: 'org_A',
      membershipId: pending.id,
      decidedBy: 'owner_user',
      userId: 'user_shadow_1',
      decisionNote: 'welcome',
    });
    expect(approved?.status).toBe('ACTIVE');
    expect(approved?.userId).toBe('user_shadow_1');
    expect(approved?.decidedBy).toBe('owner_user');
    expect(approved?.decidedAtMs).not.toBeNull();
  });

  it('a buyer request approves WITHOUT a shadow user', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const pending = await repo.requestPairing({
      ...requestBase,
      tenantIdentityId: 'ident_buyer',
      relationshipType: 'buyer_connection',
    });
    const approved = await repo.approve({
      organizationId: 'org_A',
      membershipId: pending.id,
      decidedBy: 'owner_user',
    });
    expect(approved?.status).toBe('ACTIVE');
    expect(approved?.userId).toBeNull();
  });

  it('reject → REJECTED; re-request resurrects to PENDING; approve again works', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const pending = await repo.requestPairing(requestBase);
    const rejected = await repo.reject({
      organizationId: 'org_A',
      membershipId: pending.id,
      decidedBy: 'owner_user',
      decisionNote: 'not hiring',
    });
    expect(rejected?.status).toBe('REJECTED');
    // Rejecting twice finds no PENDING row.
    expect(
      await repo.reject({
        organizationId: 'org_A',
        membershipId: pending.id,
        decidedBy: 'owner_user',
      }),
    ).toBeNull();

    const reRequested = await repo.requestPairing({
      ...requestBase,
      requestedNote: 'second try',
    });
    expect(reRequested.id).toBe(pending.id); // same (identity, org) row
    expect(reRequested.status).toBe('PENDING');
    expect(reRequested.requestedNote).toBe('second try');
    expect(reRequested.decidedBy).toBeNull(); // prior decision cleared
  });

  it('revoke ends an ACTIVE membership org-side; re-request is allowed', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const m = await repo.connect(baseConnect);
    const revoked = await repo.revoke({
      organizationId: 'org_A',
      membershipId: m.id,
      decidedBy: 'owner_user',
      decisionNote: 'contract ended',
    });
    expect(revoked?.status).toBe('REVOKED');
    // Audit keeps the shadow user reference; access is cut because only
    // ACTIVE memberships pass switch auth / audience fan.
    expect(revoked?.userId).toBe('user_A1');
    expect(await repo.verifyActiveMembership('ident_1', 'org_A')).toBeNull();

    const reRequested = await repo.requestPairing({
      ...baseConnect,
      requestedNote: 'rehire me',
    });
    expect(reRequested.status).toBe('PENDING');
  });

  it('request against an ACTIVE membership / BLOCKED row is returned unchanged', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const active = await repo.connect(baseConnect);
    const requestedWhileActive = await repo.requestPairing({
      ...requestBase,
      tenantIdentityId: 'ident_1',
    });
    expect(requestedWhileActive.id).toBe(active.id);
    expect(requestedWhileActive.status).toBe('ACTIVE'); // unchanged

    await repo.block({
      organizationId: 'org_A',
      membershipId: active.id,
      reason: 'fraud',
    });
    const requestedWhileBlocked = await repo.requestPairing({
      ...requestBase,
      tenantIdentityId: 'ident_1',
    });
    expect(requestedWhileBlocked.status).toBe('BLOCKED'); // route must 403
  });

  it('listPendingForOrg returns the approval queue oldest-first, org-scoped', async () => {
    let t = 1_000;
    const repo = createInMemoryOrgMembershipRepository({ now: () => (t += 1_000) });
    await repo.requestPairing({ ...requestBase, tenantIdentityId: 'i1' });
    await repo.requestPairing({ ...requestBase, tenantIdentityId: 'i2' });
    await repo.requestPairing({
      ...requestBase,
      tenantIdentityId: 'i3',
      organizationId: 'org_OTHER',
    });
    const queue = await repo.listPendingForOrg('org_A');
    expect(queue.map((m) => m.tenantIdentityId)).toEqual(['i1', 'i2']);
  });

  it('approve/reject are org-scoped (wrong org → null, untouched)', async () => {
    const repo = createInMemoryOrgMembershipRepository();
    const pending = await repo.requestPairing(requestBase);
    expect(
      await repo.approve({
        organizationId: 'org_OTHER',
        membershipId: pending.id,
        decidedBy: 'owner_user',
        userId: 'u',
      }),
    ).toBeNull();
    expect((await repo.listPendingForOrg('org_A'))).toHaveLength(1);
  });
});
