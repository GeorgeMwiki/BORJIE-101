/**
 * In-memory OrgMembershipRepository twin — same surface and state machine as
 * the Drizzle implementation (org-membership.repository.ts), backed by Maps.
 * Used by unit tests and the gateway's pre-injected test contexts.
 */

import { randomUUID } from 'node:crypto';
import {
  assertKey,
  assertShadowUserInvariant,
  InviteRedemptionError,
  rowToMembership,
  type DecideMembershipInput,
  type MembershipRow,
  type OrgMembershipRelationshipType,
  type OrgMembershipRepository,
} from './org-membership.types.js';

interface MemInvite {
  code: string;
  organizationId: string;
  platformTenantId: string;
  defaultRoleId: string;
  relationshipType: OrgMembershipRelationshipType;
  expiresAt: Date | null;
  revokedAt: Date | null;
  maxRedemptions: number | null;
  redemptionsUsed: number;
}

export interface InMemoryOrgMembershipSeed {
  /** Pre-seed invite codes the redeemInvite tests consume. */
  readonly invites?: ReadonlyArray<{
    readonly code: string;
    readonly organizationId: string;
    readonly platformTenantId: string;
    readonly defaultRoleId: string;
    /** The relationship the invite grants. Defaults 'employment'. */
    readonly relationshipType?: OrgMembershipRelationshipType;
    readonly expiresAt?: Date | null;
    readonly revokedAt?: Date | null;
    readonly maxRedemptions?: number | null;
    readonly redemptionsUsed?: number;
  }>;
  readonly now?: () => number;
}

const RE_REQUESTABLE = new Set(['LEFT', 'REJECTED', 'REVOKED']);

export function createInMemoryOrgMembershipRepository(
  seed?: InMemoryOrgMembershipSeed,
): OrgMembershipRepository {
  const now = seed?.now ?? (() => Date.now());
  const rows = new Map<string, MembershipRow>();
  const invites = new Map<string, MemInvite>();
  for (const i of seed?.invites ?? []) {
    invites.set(i.code, {
      code: i.code,
      organizationId: i.organizationId,
      platformTenantId: i.platformTenantId,
      defaultRoleId: i.defaultRoleId,
      relationshipType: i.relationshipType ?? 'employment',
      expiresAt: i.expiresAt ?? null,
      revokedAt: i.revokedAt ?? null,
      maxRedemptions: i.maxRedemptions ?? null,
      redemptionsUsed: i.redemptionsUsed ?? 0,
    });
  }

  function findRow(
    tenantIdentityId: string,
    organizationId: string,
  ): MembershipRow | undefined {
    for (const r of rows.values()) {
      if (
        r.tenantIdentityId === tenantIdentityId &&
        r.organizationId === organizationId
      ) {
        return r;
      }
    }
    return undefined;
  }

  function newRow(
    base: Omit<
      MembershipRow,
      | 'id'
      | 'joinedAt'
      | 'leftAt'
      | 'blockedAt'
      | 'blockReason'
      | 'decidedBy'
      | 'decidedAt'
      | 'decisionNote'
    >,
  ): MembershipRow {
    const ts = new Date(now());
    const row: MembershipRow = {
      ...base,
      id: `mem_${randomUUID()}`,
      joinedAt: ts,
      leftAt: null,
      blockedAt: null,
      blockReason: null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    };
    rows.set(row.id, row);
    return row;
  }

  function activate(
    base: {
      tenantIdentityId: string;
      organizationId: string;
      platformTenantId: string;
      userId: string | null;
      relationshipType: OrgMembershipRelationshipType;
      memberRole: string | null;
      nickname: string | null;
      joinedViaInviteCode: string | null;
    },
  ): MembershipRow {
    const existing = findRow(base.tenantIdentityId, base.organizationId);
    if (existing) {
      if (existing.status === 'BLOCKED') return existing; // untouched
      const next: MembershipRow = {
        ...existing,
        status: 'ACTIVE',
        relationshipType: base.relationshipType,
        memberRole: base.memberRole,
        userId: base.userId,
        joinedViaInviteCode:
          base.joinedViaInviteCode ?? existing.joinedViaInviteCode,
        leftAt: null,
        blockedAt: null,
        blockReason: null,
        requestedNote: null,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      };
      rows.set(next.id, next);
      return next;
    }
    return newRow({
      ...base,
      status: 'ACTIVE',
      requestedNote: null,
    });
  }

  function decideRow(
    input: DecideMembershipInput,
    fromStatus: 'PENDING' | 'ACTIVE',
    toStatus: 'ACTIVE' | 'REJECTED' | 'REVOKED',
    extra: Partial<MembershipRow>,
    op: string,
  ): MembershipRow | null {
    assertKey(input.organizationId, op, 'organizationId');
    assertKey(input.membershipId, op, 'membershipId');
    assertKey(input.decidedBy, op, 'decidedBy');
    const r = rows.get(input.membershipId);
    if (
      !r ||
      r.organizationId !== input.organizationId ||
      r.status !== fromStatus
    ) {
      return null;
    }
    const next: MembershipRow = {
      ...r,
      ...extra,
      status: toStatus,
      decidedBy: input.decidedBy,
      decidedAt: new Date(now()),
      decisionNote: input.decisionNote ?? null,
    };
    rows.set(next.id, next);
    return next;
  }

  return {
    async connect(input) {
      assertKey(input.tenantIdentityId, 'connect', 'tenantIdentityId');
      assertKey(input.organizationId, 'connect', 'organizationId');
      assertKey(input.platformTenantId, 'connect', 'platformTenantId');
      const userId = assertShadowUserInvariant(
        input.relationshipType,
        input.userId,
        'connect',
      );
      return rowToMembership(
        activate({
          tenantIdentityId: input.tenantIdentityId,
          organizationId: input.organizationId,
          platformTenantId: input.platformTenantId,
          userId,
          relationshipType: input.relationshipType,
          memberRole: input.memberRole ?? null,
          nickname: input.nickname ?? null,
          joinedViaInviteCode: null,
        }),
      );
    },

    async peekInvite(code) {
      assertKey(code, 'peekInvite', 'code');
      const invite = invites.get(code);
      if (!invite) return null;
      const redeemable =
        invite.revokedAt === null &&
        (invite.expiresAt === null || invite.expiresAt.getTime() > now()) &&
        (invite.maxRedemptions === null ||
          invite.redemptionsUsed < invite.maxRedemptions);
      return Object.freeze({
        code: invite.code,
        organizationId: invite.organizationId,
        platformTenantId: invite.platformTenantId,
        relationshipType: invite.relationshipType,
        defaultRoleId: invite.defaultRoleId,
        redeemable,
      });
    },

    async redeemInvite(input) {
      assertKey(input.code, 'redeemInvite', 'code');
      assertKey(input.tenantIdentityId, 'redeemInvite', 'tenantIdentityId');
      const invite = invites.get(input.code);
      const live =
        invite &&
        invite.revokedAt === null &&
        (invite.expiresAt === null || invite.expiresAt.getTime() > now()) &&
        (invite.maxRedemptions === null ||
          invite.redemptionsUsed < invite.maxRedemptions);
      if (!invite || !live) {
        throw new InviteRedemptionError(
          'Invite code is invalid, expired, revoked, or fully redeemed.',
        );
      }
      // Trust-direction fix: relationship from the INVITE, not the caller.
      const userId = assertShadowUserInvariant(
        invite.relationshipType,
        input.userId,
        'redeemInvite',
      );
      invites.set(input.code, {
        ...invite,
        redemptionsUsed: invite.redemptionsUsed + 1,
      });
      const row = activate({
        tenantIdentityId: input.tenantIdentityId,
        organizationId: invite.organizationId,
        platformTenantId: invite.platformTenantId,
        userId,
        relationshipType: invite.relationshipType,
        memberRole: invite.defaultRoleId,
        nickname: input.nickname ?? null,
        joinedViaInviteCode: input.code,
      });
      return {
        membership: rowToMembership(row),
        organizationId: invite.organizationId,
        platformTenantId: invite.platformTenantId,
      };
    },

    async requestPairing(input) {
      assertKey(input.tenantIdentityId, 'requestPairing', 'tenantIdentityId');
      assertKey(input.organizationId, 'requestPairing', 'organizationId');
      assertKey(input.platformTenantId, 'requestPairing', 'platformTenantId');
      const existing = findRow(input.tenantIdentityId, input.organizationId);
      if (existing) {
        if (!RE_REQUESTABLE.has(existing.status)) {
          // ACTIVE / PENDING / BLOCKED — unchanged; the route maps each.
          return rowToMembership(existing);
        }
        const next: MembershipRow = {
          ...existing,
          status: 'PENDING',
          relationshipType: input.relationshipType,
          memberRole: input.memberRole ?? null,
          requestedNote: input.requestedNote ?? null,
          joinedAt: new Date(now()),
          leftAt: null,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        };
        rows.set(next.id, next);
        return rowToMembership(next);
      }
      return rowToMembership(
        newRow({
          tenantIdentityId: input.tenantIdentityId,
          organizationId: input.organizationId,
          platformTenantId: input.platformTenantId,
          userId: null,
          status: 'PENDING',
          relationshipType: input.relationshipType,
          memberRole: input.memberRole ?? null,
          nickname: input.nickname ?? null,
          joinedViaInviteCode: null,
          requestedNote: input.requestedNote ?? null,
        }),
      );
    },

    async approve(input) {
      assertKey(input.organizationId, 'approve', 'organizationId');
      assertKey(input.membershipId, 'approve', 'membershipId');
      assertKey(input.decidedBy, 'approve', 'decidedBy');
      const pending = rows.get(input.membershipId);
      if (
        !pending ||
        pending.organizationId !== input.organizationId ||
        pending.status !== 'PENDING'
      ) {
        return null;
      }
      const userId = assertShadowUserInvariant(
        pending.relationshipType,
        input.userId,
        'approve',
      );
      const row = decideRow(input, 'PENDING', 'ACTIVE', { userId }, 'approve');
      return row ? rowToMembership(row) : null;
    },

    async reject(input) {
      const row = decideRow(input, 'PENDING', 'REJECTED', {}, 'reject');
      return row ? rowToMembership(row) : null;
    },

    async revoke(input) {
      const row = decideRow(input, 'ACTIVE', 'REVOKED', {}, 'revoke');
      return row ? rowToMembership(row) : null;
    },

    async listPendingForOrg(organizationId) {
      assertKey(organizationId, 'listPendingForOrg', 'organizationId');
      return [...rows.values()]
        .filter(
          (r) =>
            r.organizationId === organizationId && r.status === 'PENDING',
        )
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
        .map(rowToMembership);
    },

    async listActiveForIdentity(tenantIdentityId) {
      assertKey(tenantIdentityId, 'listActiveForIdentity', 'tenantIdentityId');
      return [...rows.values()]
        .filter(
          (r) =>
            r.tenantIdentityId === tenantIdentityId && r.status === 'ACTIVE',
        )
        .map(rowToMembership);
    },

    async verifyActiveMembership(tenantIdentityId, organizationId) {
      assertKey(tenantIdentityId, 'verifyActiveMembership', 'tenantIdentityId');
      assertKey(organizationId, 'verifyActiveMembership', 'organizationId');
      const r = findRow(tenantIdentityId, organizationId);
      return r && r.status === 'ACTIVE' ? rowToMembership(r) : null;
    },

    async resolveAudience(organizationId, query) {
      assertKey(organizationId, 'resolveAudience', 'organizationId');
      const roles = query?.memberRoles?.filter(Boolean) ?? [];
      return [...rows.values()]
        .filter(
          (r) =>
            r.organizationId === organizationId &&
            r.status === 'ACTIVE' &&
            (!query?.relationshipType ||
              r.relationshipType === query.relationshipType) &&
            (roles.length === 0 ||
              (r.memberRole !== null && roles.includes(r.memberRole))),
        )
        .map(rowToMembership);
    },

    async leave(tenantIdentityId, organizationId) {
      assertKey(tenantIdentityId, 'leave', 'tenantIdentityId');
      assertKey(organizationId, 'leave', 'organizationId');
      const r = findRow(tenantIdentityId, organizationId);
      if (!r || r.status !== 'ACTIVE') return null;
      const next: MembershipRow = {
        ...r,
        status: 'LEFT',
        leftAt: new Date(now()),
      };
      rows.set(next.id, next);
      return rowToMembership(next);
    },

    async block(input) {
      assertKey(input.organizationId, 'block', 'organizationId');
      assertKey(input.membershipId, 'block', 'membershipId');
      const r = rows.get(input.membershipId);
      if (!r || r.organizationId !== input.organizationId) return null;
      const next: MembershipRow = {
        ...r,
        status: 'BLOCKED',
        blockedAt: new Date(now()),
        blockReason: input.reason ?? null,
      };
      rows.set(next.id, next);
      return rowToMembership(next);
    },
  };
}
