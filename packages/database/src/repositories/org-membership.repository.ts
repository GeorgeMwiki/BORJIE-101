/**
 * OrgMembershipRepository — the write-path + targeting reads for the
 * User⟷Membership⟷Org substrate (identity.schema: tenant_identities = global
 * principal, org_memberships = the per-org join, invite_codes = the connect
 * token). Until now the join table was DARK: created in 0305, RLS-scoped in
 * 0336, columns added in 0344 — but with ZERO write-path. This repository is
 * that write-path, plus the targeting reads the multi-org JWT, the org-switcher
 * and the surface-completion audience resolver need.
 *
 * SEAM: this repository owns the MEMBERSHIP lifecycle only. It never provisions
 * the shadow `users` row — the caller resolves/provisions that upstream (via the
 * existing auth / UserRepository path) and passes `userId`. Keeping user
 * provisioning out of here preserves the one-RBAC-source invariant: authz always
 * resolves through the shadow user_id + RLS, never through this graph.
 *
 * Two implementations (the org-loop-run / md-commitment two-impl pattern):
 *   - createDrizzleOrgMembershipRepository(db) — PROD. Cross-org by nature (a
 *     buyer/worker holds memberships across many platform tenants; the unified
 *     home + switcher read the whole SET), so every method runs inside
 *     `withServiceRoleContext` — the org_memberships service-role bypass policy
 *     (0336) lets the SET read cross the tenant GUC while RLS FORCE still
 *     isolates every request caller. Every method is explicitly key-scoped in
 *     SQL (tenantIdentityId / organizationId) as defence in depth, so the bypass
 *     never over-reads by accident.
 *   - createInMemoryOrgMembershipRepository() — TESTS. Same surface, a Map.
 *
 * Immutable: inputs are spread into fresh rows; reads return frozen snapshots;
 * the repository never mutates a caller's object. No `console.*` (silent degrade).
 */

import { randomUUID } from 'node:crypto';
import { and, eq, ne, inArray, sql } from 'drizzle-orm';

import { orgMemberships, inviteCodes } from '../schemas/identity.schema.js';
import type { DatabaseClient } from '../client.js';
import { withServiceRoleContext } from '../rls/with-tenant-context.js';

// ---------------------------------------------------------------------------
// Domain types — the immutable membership view the surfaces read.
// ---------------------------------------------------------------------------

export type OrgMembershipStatus = 'ACTIVE' | 'LEFT' | 'BLOCKED';
export type OrgMembershipRelationshipType =
  | 'employment'
  | 'buyer_connection'
  | 'contractor'
  | 'guest';

export interface OrgMembership {
  readonly id: string;
  readonly tenantIdentityId: string;
  readonly organizationId: string;
  readonly platformTenantId: string;
  readonly userId: string;
  readonly status: OrgMembershipStatus;
  readonly relationshipType: OrgMembershipRelationshipType;
  readonly memberRole: string | null;
  readonly nickname: string | null;
  readonly joinedViaInviteCode: string | null;
  readonly joinedAtMs: number;
  readonly leftAtMs: number | null;
  readonly blockedAtMs: number | null;
}

/** CONNECT input — a direct join (a buyer connecting, an owner adding a worker). */
export interface ConnectMembershipInput {
  readonly tenantIdentityId: string;
  readonly organizationId: string;
  readonly platformTenantId: string;
  /** The shadow user row (provisioned upstream — see the SEAM note). */
  readonly userId: string;
  readonly relationshipType: OrgMembershipRelationshipType;
  readonly memberRole?: string | null;
  readonly nickname?: string | null;
}

/** REDEEM input — consume an invite_code into a membership atomically. */
export interface RedeemInviteInput {
  readonly code: string;
  readonly tenantIdentityId: string;
  /** The shadow user row in the invite's platform tenant (provisioned upstream). */
  readonly userId: string;
  /** The relationship the invite grants. Defaults 'employment'. */
  readonly relationshipType?: OrgMembershipRelationshipType;
  readonly nickname?: string | null;
}

export interface RedeemInviteResult {
  readonly membership: OrgMembership;
  /** The org/tenant the consumed invite resolved to. */
  readonly organizationId: string;
  readonly platformTenantId: string;
}

/** BLOCK input — an org blocks one of its members. */
export interface BlockMembershipInput {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly reason?: string | null;
}

/** A relationship/role-class predicate the audience resolver fans over. */
export interface AudienceQuery {
  readonly relationshipType?: OrgMembershipRelationshipType;
  /** Role-class targeting (member_role IN ...). Empty/undefined = any role. */
  readonly memberRoles?: ReadonlyArray<string>;
}

export interface OrgMembershipRepository {
  /** Direct join (idempotent on (identity, org); reactivates a LEFT row; a
   *  BLOCKED row is returned unchanged — a blocked member can't self-reconnect). */
  connect(input: ConnectMembershipInput): Promise<OrgMembership>;
  /** Atomically consume an invite_code → a membership in the invite's org. */
  redeemInvite(input: RedeemInviteInput): Promise<RedeemInviteResult>;
  /** The unified-home / switcher read: every ACTIVE membership of an identity. */
  listActiveForIdentity(
    tenantIdentityId: string,
  ): Promise<ReadonlyArray<OrgMembership>>;
  /** The switch authorization: the identity's ACTIVE membership in one org. */
  verifyActiveMembership(
    tenantIdentityId: string,
    organizationId: string,
  ): Promise<OrgMembership | null>;
  /** The audience resolver: ACTIVE memberships in an org by relationship/role. */
  resolveAudience(
    organizationId: string,
    query?: AudienceQuery,
  ): Promise<ReadonlyArray<OrgMembership>>;
  /** Leave one of your own memberships (status → LEFT). Returns null if none. */
  leave(
    tenantIdentityId: string,
    organizationId: string,
  ): Promise<OrgMembership | null>;
  /** An org blocks a member (status → BLOCKED). Returns null if not found. */
  block(input: BlockMembershipInput): Promise<OrgMembership | null>;
}

// ---------------------------------------------------------------------------
// Validation + mapping
// ---------------------------------------------------------------------------

/** Typed redemption failure so the route can map it to a 4xx, not a 500. */
export class InviteRedemptionError extends Error {
  readonly code = 'INVITE_NOT_REDEEMABLE';
  constructor(message: string) {
    super(message);
    this.name = 'InviteRedemptionError';
  }
}

/**
 * Defence-in-depth key assert. Every method runs under the service-role RLS
 * BYPASS, so an empty key param could otherwise become a silent over-read.
 */
function assertKey(value: string, op: string, name: string): void {
  if (!value) {
    throw new Error(`org-membership: ${op} requires a non-empty ${name}`);
  }
}

function ms(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

interface MembershipRow {
  id: string;
  tenantIdentityId: string;
  organizationId: string;
  platformTenantId: string;
  userId: string;
  status: OrgMembershipStatus;
  relationshipType: OrgMembershipRelationshipType;
  memberRole: string | null;
  nickname: string | null;
  joinedViaInviteCode: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  blockedAt: Date | null;
  blockReason: string | null;
}

function rowToMembership(row: MembershipRow): OrgMembership {
  return Object.freeze({
    id: row.id,
    tenantIdentityId: row.tenantIdentityId,
    organizationId: row.organizationId,
    platformTenantId: row.platformTenantId,
    userId: row.userId,
    status: row.status,
    relationshipType: row.relationshipType,
    memberRole: row.memberRole ?? null,
    nickname: row.nickname ?? null,
    joinedViaInviteCode: row.joinedViaInviteCode ?? null,
    joinedAtMs: row.joinedAt.getTime(),
    leftAtMs: ms(row.leftAt),
    blockedAtMs: ms(row.blockedAt),
  });
}

function newMembershipId(): string {
  return `mem_${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Drizzle implementation (service-role; cross-org safe)
// ---------------------------------------------------------------------------

export function createDrizzleOrgMembershipRepository(
  db: DatabaseClient,
): OrgMembershipRepository {
  async function readByIdentityOrg(
    tx: DatabaseClient,
    tenantIdentityId: string,
    organizationId: string,
  ): Promise<OrgMembership | null> {
    const rows = (await tx
      .select()
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.tenantIdentityId, tenantIdentityId),
          eq(orgMemberships.organizationId, organizationId),
        ),
      )
      .limit(1)) as unknown as MembershipRow[];
    const row = rows[0];
    return row ? rowToMembership(row) : null;
  }

  return {
    async connect(input) {
      assertKey(input.tenantIdentityId, 'connect', 'tenantIdentityId');
      assertKey(input.organizationId, 'connect', 'organizationId');
      assertKey(input.platformTenantId, 'connect', 'platformTenantId');
      assertKey(input.userId, 'connect', 'userId');
      return withServiceRoleContext(db, async (tx) => {
        // Upsert on (identity, org): a fresh join inserts; a prior LEFT row
        // reactivates; a BLOCKED row is left untouched (setWhere excludes it),
        // so a blocked member can never silently self-reconnect.
        const inserted = (await tx
          .insert(orgMemberships)
          .values({
            id: newMembershipId(),
            tenantIdentityId: input.tenantIdentityId,
            organizationId: input.organizationId,
            platformTenantId: input.platformTenantId,
            userId: input.userId,
            status: 'ACTIVE',
            relationshipType: input.relationshipType,
            memberRole: input.memberRole ?? null,
            nickname: input.nickname ?? null,
          })
          .onConflictDoUpdate({
            target: [
              orgMemberships.tenantIdentityId,
              orgMemberships.organizationId,
            ],
            set: {
              status: 'ACTIVE',
              relationshipType: input.relationshipType,
              memberRole: input.memberRole ?? null,
              leftAt: null,
              blockedAt: null,
              blockReason: null,
            },
            setWhere: ne(orgMemberships.status, 'BLOCKED'),
          })
          .returning()) as unknown as MembershipRow[];
        const row = inserted[0];
        if (row) return rowToMembership(row);
        // setWhere excluded a BLOCKED row — return it unchanged so the caller
        // sees status=BLOCKED and refuses the connect at the route layer.
        const existing = await readByIdentityOrg(
          tx,
          input.tenantIdentityId,
          input.organizationId,
        );
        if (!existing) {
          throw new Error('org-membership: connect failed (no row returned)');
        }
        return existing;
      });
    },

    async redeemInvite(input) {
      assertKey(input.code, 'redeemInvite', 'code');
      assertKey(input.tenantIdentityId, 'redeemInvite', 'tenantIdentityId');
      assertKey(input.userId, 'redeemInvite', 'userId');
      return withServiceRoleContext(db, async (tx) => {
        // Atomic consume: increment redemptions only while the invite is live
        // (not revoked, not expired, redemptions remaining). 0 rows = not
        // redeemable. This is the single source of consumption truth — a
        // concurrent double-redeem can take at most maxRedemptions slots.
        const consumed = (await tx
          .update(inviteCodes)
          .set({ redemptionsUsed: sql`${inviteCodes.redemptionsUsed} + 1` })
          .where(
            and(
              eq(inviteCodes.code, input.code),
              sql`${inviteCodes.revokedAt} IS NULL`,
              sql`(${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > now())`,
              sql`(${inviteCodes.maxRedemptions} IS NULL OR ${inviteCodes.redemptionsUsed} < ${inviteCodes.maxRedemptions})`,
            ),
          )
          .returning({
            organizationId: inviteCodes.organizationId,
            platformTenantId: inviteCodes.platformTenantId,
            defaultRoleId: inviteCodes.defaultRoleId,
          })) as unknown as Array<{
          organizationId: string;
          platformTenantId: string;
          defaultRoleId: string;
        }>;
        const invite = consumed[0];
        if (!invite) {
          throw new InviteRedemptionError(
            'Invite code is invalid, expired, revoked, or fully redeemed.',
          );
        }
        // Create (or reactivate) the membership in the invite's org. member_role
        // is the invite's default role as a TARGETING label (not authz).
        const inserted = (await tx
          .insert(orgMemberships)
          .values({
            id: newMembershipId(),
            tenantIdentityId: input.tenantIdentityId,
            organizationId: invite.organizationId,
            platformTenantId: invite.platformTenantId,
            userId: input.userId,
            status: 'ACTIVE',
            relationshipType: input.relationshipType ?? 'employment',
            memberRole: invite.defaultRoleId,
            nickname: input.nickname ?? null,
            joinedViaInviteCode: input.code,
          })
          .onConflictDoUpdate({
            target: [
              orgMemberships.tenantIdentityId,
              orgMemberships.organizationId,
            ],
            set: {
              status: 'ACTIVE',
              relationshipType: input.relationshipType ?? 'employment',
              memberRole: invite.defaultRoleId,
              joinedViaInviteCode: input.code,
              leftAt: null,
              blockedAt: null,
              blockReason: null,
            },
            setWhere: ne(orgMemberships.status, 'BLOCKED'),
          })
          .returning()) as unknown as MembershipRow[];
        const row = inserted[0];
        const membership =
          row !== undefined
            ? rowToMembership(row)
            : await readByIdentityOrg(
                tx,
                input.tenantIdentityId,
                invite.organizationId,
              );
        if (!membership) {
          throw new Error('org-membership: redeem failed (no membership row)');
        }
        return {
          membership,
          organizationId: invite.organizationId,
          platformTenantId: invite.platformTenantId,
        };
      });
    },

    async listActiveForIdentity(tenantIdentityId) {
      assertKey(tenantIdentityId, 'listActiveForIdentity', 'tenantIdentityId');
      return withServiceRoleContext(db, async (tx) => {
        const rows = (await tx
          .select()
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.tenantIdentityId, tenantIdentityId),
              eq(orgMemberships.status, 'ACTIVE'),
            ),
          )) as unknown as MembershipRow[];
        return rows.map(rowToMembership);
      });
    },

    async verifyActiveMembership(tenantIdentityId, organizationId) {
      assertKey(tenantIdentityId, 'verifyActiveMembership', 'tenantIdentityId');
      assertKey(organizationId, 'verifyActiveMembership', 'organizationId');
      return withServiceRoleContext(db, async (tx) => {
        const rows = (await tx
          .select()
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.tenantIdentityId, tenantIdentityId),
              eq(orgMemberships.organizationId, organizationId),
              eq(orgMemberships.status, 'ACTIVE'),
            ),
          )
          .limit(1)) as unknown as MembershipRow[];
        const row = rows[0];
        return row ? rowToMembership(row) : null;
      });
    },

    async resolveAudience(organizationId, query) {
      assertKey(organizationId, 'resolveAudience', 'organizationId');
      const roles = query?.memberRoles?.filter(Boolean) ?? [];
      return withServiceRoleContext(db, async (tx) => {
        const rows = (await tx
          .select()
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.organizationId, organizationId),
              eq(orgMemberships.status, 'ACTIVE'),
              ...(query?.relationshipType
                ? [eq(orgMemberships.relationshipType, query.relationshipType)]
                : []),
              ...(roles.length > 0
                ? [inArray(orgMemberships.memberRole, [...roles])]
                : []),
            ),
          )) as unknown as MembershipRow[];
        return rows.map(rowToMembership);
      });
    },

    async leave(tenantIdentityId, organizationId) {
      assertKey(tenantIdentityId, 'leave', 'tenantIdentityId');
      assertKey(organizationId, 'leave', 'organizationId');
      return withServiceRoleContext(db, async (tx) => {
        const updated = (await tx
          .update(orgMemberships)
          .set({ status: 'LEFT', leftAt: new Date() })
          .where(
            and(
              eq(orgMemberships.tenantIdentityId, tenantIdentityId),
              eq(orgMemberships.organizationId, organizationId),
              // Only an ACTIVE membership can be left (idempotent / no
              // resurrecting a BLOCKED row through leave).
              eq(orgMemberships.status, 'ACTIVE'),
            ),
          )
          .returning()) as unknown as MembershipRow[];
        const row = updated[0];
        return row ? rowToMembership(row) : null;
      });
    },

    async block(input) {
      assertKey(input.organizationId, 'block', 'organizationId');
      assertKey(input.membershipId, 'block', 'membershipId');
      return withServiceRoleContext(db, async (tx) => {
        const updated = (await tx
          .update(orgMemberships)
          .set({
            status: 'BLOCKED',
            blockedAt: new Date(),
            blockReason: input.reason ?? null,
          })
          .where(
            and(
              eq(orgMemberships.id, input.membershipId),
              // org-scoped: an org can only block a member of ITS org.
              eq(orgMemberships.organizationId, input.organizationId),
            ),
          )
          .returning()) as unknown as MembershipRow[];
        const row = updated[0];
        return row ? rowToMembership(row) : null;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests; same surface, a Map)
// ---------------------------------------------------------------------------

interface MemInvite {
  code: string;
  organizationId: string;
  platformTenantId: string;
  defaultRoleId: string;
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
    readonly expiresAt?: Date | null;
    readonly revokedAt?: Date | null;
    readonly maxRedemptions?: number | null;
    readonly redemptionsUsed?: number;
  }>;
  readonly now?: () => number;
}

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

  function upsertActive(
    base: {
      tenantIdentityId: string;
      organizationId: string;
      platformTenantId: string;
      userId: string;
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
        joinedViaInviteCode:
          base.joinedViaInviteCode ?? existing.joinedViaInviteCode,
        leftAt: null,
        blockedAt: null,
        blockReason: null,
      };
      rows.set(next.id, next);
      return next;
    }
    const ts = new Date(now());
    const row: MembershipRow = {
      id: newMembershipId(),
      tenantIdentityId: base.tenantIdentityId,
      organizationId: base.organizationId,
      platformTenantId: base.platformTenantId,
      userId: base.userId,
      status: 'ACTIVE',
      relationshipType: base.relationshipType,
      memberRole: base.memberRole,
      nickname: base.nickname,
      joinedViaInviteCode: base.joinedViaInviteCode,
      joinedAt: ts,
      leftAt: null,
      blockedAt: null,
      blockReason: null,
    };
    rows.set(row.id, row);
    return row;
  }

  return {
    async connect(input) {
      assertKey(input.tenantIdentityId, 'connect', 'tenantIdentityId');
      assertKey(input.organizationId, 'connect', 'organizationId');
      assertKey(input.platformTenantId, 'connect', 'platformTenantId');
      assertKey(input.userId, 'connect', 'userId');
      return rowToMembership(
        upsertActive({
          tenantIdentityId: input.tenantIdentityId,
          organizationId: input.organizationId,
          platformTenantId: input.platformTenantId,
          userId: input.userId,
          relationshipType: input.relationshipType,
          memberRole: input.memberRole ?? null,
          nickname: input.nickname ?? null,
          joinedViaInviteCode: null,
        }),
      );
    },

    async redeemInvite(input) {
      assertKey(input.code, 'redeemInvite', 'code');
      assertKey(input.tenantIdentityId, 'redeemInvite', 'tenantIdentityId');
      assertKey(input.userId, 'redeemInvite', 'userId');
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
      invites.set(input.code, {
        ...invite,
        redemptionsUsed: invite.redemptionsUsed + 1,
      });
      const row = upsertActive({
        tenantIdentityId: input.tenantIdentityId,
        organizationId: invite.organizationId,
        platformTenantId: invite.platformTenantId,
        userId: input.userId,
        relationshipType: input.relationshipType ?? 'employment',
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
