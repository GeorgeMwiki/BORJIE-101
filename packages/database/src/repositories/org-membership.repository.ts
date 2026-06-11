/**
 * OrgMembershipRepository — the write-path + targeting reads for the
 * User⟷Membership⟷Org substrate (identity.schema: tenant_identities = global
 * principal, org_memberships = the per-org join, invite_codes = the connect
 * token). Created dark in 0305, RLS-scoped in 0336, discriminated in 0344,
 * CORRECTED in 0345 (buyer ≠ tenant-insider + the full pairing state
 * machine — see org-membership.types.ts for the model and the state chart).
 *
 * SEAM: this repository owns the MEMBERSHIP lifecycle only. It never
 * provisions the shadow `users` row — the caller resolves/provisions that
 * upstream (shadow-user provisioner / UserRepository) and passes `userId`
 * where the state machine requires one (ACTIVE employment-class). Keeping
 * user provisioning out of here preserves the one-RBAC-source invariant:
 * authz always resolves through the shadow user_id + RLS, never through
 * this graph. Buyers NEVER get a userId (enforced here AND by the DB CHECK).
 *
 * Two implementations (the org-loop-run / md-commitment two-impl pattern):
 *   - createDrizzleOrgMembershipRepository(db) — PROD. Cross-org by nature (a
 *     buyer/worker holds memberships across many platform tenants; the unified
 *     home + switcher read the whole SET), so every method runs inside
 *     `withServiceRoleContext` — the org_memberships service-role bypass policy
 *     (0336) lets the SET read cross the tenant GUC while RLS FORCE still
 *     isolates every request caller. Every method is explicitly key-scoped in
 *     SQL (tenantIdentityId / organizationId) as defence in depth, so the
 *     bypass never over-reads by accident.
 *   - createInMemoryOrgMembershipRepository() — TESTS (org-membership.memory.ts).
 *
 * Immutable: inputs are spread into fresh rows; reads return frozen snapshots;
 * the repository never mutates a caller's object. No `console.*`.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, ne, inArray, sql } from 'drizzle-orm';

import { orgMemberships, inviteCodes } from '../schemas/identity.schema.js';
import type { DatabaseClient } from '../client.js';
import { withServiceRoleContext } from '../rls/with-tenant-context.js';
import {
  assertKey,
  assertShadowUserInvariant,
  InviteRedemptionError,
  rowToMembership,
  type ApproveMembershipInput,
  type BlockMembershipInput,
  type DecideMembershipInput,
  type InvitePeek,
  type MembershipRow,
  type OrgMembership,
  type OrgMembershipRepository,
} from './org-membership.types.js';

// Re-export the full domain surface so existing importers (barrel, routes,
// tests) keep a single import path.
export * from './org-membership.types.js';
export {
  createInMemoryOrgMembershipRepository,
  type InMemoryOrgMembershipSeed,
} from './org-membership.memory.js';

export function newMembershipId(): string {
  return `mem_${randomUUID()}`;
}

/**
 * Invite codes are URL/QR-friendly: 12 chars from an unambiguous alphabet
 * (no 0/O/1/I/L), sourced from crypto randomness — ~56 bits of entropy.
 */
// eslint-disable-next-line no-secrets/no-secrets -- public Crockford-style code alphabet (no 0/O/1/I/L), not a credential
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const bytes = new Uint8Array(12);
  // randomUUID-based fallback is unnecessary — node:crypto webcrypto is
  // always present on the supported runtimes.
  globalThis.crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) {
    code += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  }
  return code;
}

/** Statuses a public re-request may resurrect from (mode b). */
const RE_REQUESTABLE = ['LEFT', 'REJECTED', 'REVOKED'] as const;

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

  async function decide(
    input: DecideMembershipInput,
    fromStatus: 'PENDING' | 'ACTIVE',
    toStatus: 'ACTIVE' | 'REJECTED' | 'REVOKED',
    extraSet: Partial<{ userId: string | null }>,
    op: string,
  ): Promise<OrgMembership | null> {
    assertKey(input.organizationId, op, 'organizationId');
    assertKey(input.membershipId, op, 'membershipId');
    assertKey(input.decidedBy, op, 'decidedBy');
    return withServiceRoleContext(db, async (tx) => {
      const updated = (await tx
        .update(orgMemberships)
        .set({
          status: toStatus,
          decidedBy: input.decidedBy,
          decidedAt: new Date(),
          decisionNote: input.decisionNote ?? null,
          ...extraSet,
        })
        .where(
          and(
            eq(orgMemberships.id, input.membershipId),
            // org-scoped: an org can only decide on a member of ITS org.
            eq(orgMemberships.organizationId, input.organizationId),
            eq(orgMemberships.status, fromStatus),
          ),
        )
        .returning()) as unknown as MembershipRow[];
      const row = updated[0];
      return row ? rowToMembership(row) : null;
    });
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
      return withServiceRoleContext(db, async (tx) => {
        // Upsert on (identity, org): a fresh join inserts; a prior
        // LEFT/REJECTED/REVOKED/PENDING row reactivates (org-initiated, so a
        // pending request is implicitly approved); a BLOCKED row is left
        // untouched (setWhere excludes it) — a blocked member can never
        // silently reconnect.
        const inserted = (await tx
          .insert(orgMemberships)
          .values({
            id: newMembershipId(),
            tenantIdentityId: input.tenantIdentityId,
            organizationId: input.organizationId,
            platformTenantId: input.platformTenantId,
            userId,
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
              userId,
              leftAt: null,
              blockedAt: null,
              blockReason: null,
              requestedNote: null,
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
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

    async peekInvite(code) {
      assertKey(code, 'peekInvite', 'code');
      return withServiceRoleContext(db, async (tx) => {
        const rows = (await tx
          .select()
          .from(inviteCodes)
          .where(eq(inviteCodes.code, code))
          .limit(1)) as unknown as Array<{
          code: string;
          organizationId: string;
          platformTenantId: string;
          relationshipType: InvitePeek['relationshipType'];
          defaultRoleId: string;
          expiresAt: Date | null;
          revokedAt: Date | null;
          maxRedemptions: number | null;
          redemptionsUsed: number;
        }>;
        const invite = rows[0];
        if (!invite) return null;
        const redeemable =
          invite.revokedAt === null &&
          (invite.expiresAt === null ||
            invite.expiresAt.getTime() > Date.now()) &&
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
      });
    },

    async createInvite(input) {
      assertKey(input.organizationId, 'createInvite', 'organizationId');
      assertKey(input.platformTenantId, 'createInvite', 'platformTenantId');
      assertKey(input.issuedBy, 'createInvite', 'issuedBy');
      assertKey(input.defaultRoleId, 'createInvite', 'defaultRoleId');
      return withServiceRoleContext(db, async (tx) => {
        const inserted = (await tx
          .insert(inviteCodes)
          .values({
            code: newInviteCode(),
            organizationId: input.organizationId,
            platformTenantId: input.platformTenantId,
            issuedBy: input.issuedBy,
            defaultRoleId: input.defaultRoleId,
            relationshipType: input.relationshipType ?? 'employment',
            expiresAt: input.expiresAt ?? null,
            maxRedemptions: input.maxRedemptions ?? null,
          })
          .returning({
            code: inviteCodes.code,
            organizationId: inviteCodes.organizationId,
            platformTenantId: inviteCodes.platformTenantId,
            relationshipType: inviteCodes.relationshipType,
            defaultRoleId: inviteCodes.defaultRoleId,
          })) as unknown as Array<{
          code: string;
          organizationId: string;
          platformTenantId: string;
          relationshipType: InvitePeek['relationshipType'];
          defaultRoleId: string;
        }>;
        const row = inserted[0];
        if (!row) {
          throw new Error('org-membership: createInvite failed (no row)');
        }
        return Object.freeze({ ...row, redeemable: true });
      });
    },

    async redeemInvite(input) {
      assertKey(input.code, 'redeemInvite', 'code');
      assertKey(input.tenantIdentityId, 'redeemInvite', 'tenantIdentityId');
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
            relationshipType: inviteCodes.relationshipType,
          })) as unknown as Array<{
          organizationId: string;
          platformTenantId: string;
          defaultRoleId: string;
          relationshipType: OrgMembership['relationshipType'];
        }>;
        const invite = consumed[0];
        if (!invite) {
          throw new InviteRedemptionError(
            'Invite code is invalid, expired, revoked, or fully redeemed.',
          );
        }
        // TRUST-DIRECTION FIX (0345): the relationship comes from the INVITE
        // row, never from the redeemer's input — a caller cannot claim
        // employment against a buyer invite to obtain a shadow insider.
        const userId = assertShadowUserInvariant(
          invite.relationshipType,
          input.userId,
          'redeemInvite',
        );
        const inserted = (await tx
          .insert(orgMemberships)
          .values({
            id: newMembershipId(),
            tenantIdentityId: input.tenantIdentityId,
            organizationId: invite.organizationId,
            platformTenantId: invite.platformTenantId,
            userId,
            status: 'ACTIVE',
            relationshipType: invite.relationshipType,
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
              relationshipType: invite.relationshipType,
              memberRole: invite.defaultRoleId,
              userId,
              joinedViaInviteCode: input.code,
              leftAt: null,
              blockedAt: null,
              blockReason: null,
              requestedNote: null,
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
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

    async requestPairing(input) {
      assertKey(input.tenantIdentityId, 'requestPairing', 'tenantIdentityId');
      assertKey(input.organizationId, 'requestPairing', 'organizationId');
      assertKey(input.platformTenantId, 'requestPairing', 'platformTenantId');
      return withServiceRoleContext(db, async (tx) => {
        // A request NEVER carries a shadow user — for employment-class the
        // insider user is provisioned at APPROVE time, never before.
        const inserted = (await tx
          .insert(orgMemberships)
          .values({
            id: newMembershipId(),
            tenantIdentityId: input.tenantIdentityId,
            organizationId: input.organizationId,
            platformTenantId: input.platformTenantId,
            userId: null,
            status: 'PENDING',
            relationshipType: input.relationshipType,
            memberRole: input.memberRole ?? null,
            nickname: input.nickname ?? null,
            requestedNote: input.requestedNote ?? null,
          })
          .onConflictDoUpdate({
            target: [
              orgMemberships.tenantIdentityId,
              orgMemberships.organizationId,
            ],
            set: {
              status: 'PENDING',
              relationshipType: input.relationshipType,
              memberRole: input.memberRole ?? null,
              requestedNote: input.requestedNote ?? null,
              // The queue orders by joined_at = when this pairing lifecycle
              // (re)started.
              joinedAt: new Date(),
              leftAt: null,
              decidedBy: null,
              decidedAt: null,
              decisionNote: null,
            },
            // Re-request resurrects only LEFT/REJECTED/REVOKED. An ACTIVE
            // membership, a live PENDING request, or a BLOCKED row is
            // returned unchanged (the route maps each to its own response).
            setWhere: inArray(orgMemberships.status, [...RE_REQUESTABLE]),
          })
          .returning()) as unknown as MembershipRow[];
        const row = inserted[0];
        if (row) return rowToMembership(row);
        const existing = await readByIdentityOrg(
          tx,
          input.tenantIdentityId,
          input.organizationId,
        );
        if (!existing) {
          throw new Error(
            'org-membership: requestPairing failed (no row returned)',
          );
        }
        return existing;
      });
    },

    async approve(input: ApproveMembershipInput) {
      assertKey(input.organizationId, 'approve', 'organizationId');
      assertKey(input.membershipId, 'approve', 'membershipId');
      assertKey(input.decidedBy, 'approve', 'decidedBy');
      return withServiceRoleContext(db, async (tx) => {
        // Read first: the shadow-user requirement depends on the pending
        // row's relationship class.
        const rows = (await tx
          .select()
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.id, input.membershipId),
              eq(orgMemberships.organizationId, input.organizationId),
              eq(orgMemberships.status, 'PENDING'),
            ),
          )
          .limit(1)) as unknown as MembershipRow[];
        const pending = rows[0];
        if (!pending) return null;
        const userId = assertShadowUserInvariant(
          pending.relationshipType,
          input.userId,
          'approve',
        );
        const updated = (await tx
          .update(orgMemberships)
          .set({
            status: 'ACTIVE',
            userId,
            decidedBy: input.decidedBy,
            decidedAt: new Date(),
            decisionNote: input.decisionNote ?? null,
          })
          .where(
            and(
              eq(orgMemberships.id, input.membershipId),
              eq(orgMemberships.organizationId, input.organizationId),
              eq(orgMemberships.status, 'PENDING'),
            ),
          )
          .returning()) as unknown as MembershipRow[];
        const row = updated[0];
        return row ? rowToMembership(row) : null;
      });
    },

    async reject(input) {
      return decide(input, 'PENDING', 'REJECTED', {}, 'reject');
    },

    async revoke(input) {
      // user_id is retained on a REVOKED row for audit — the CHECK allows
      // it (the row is no longer ACTIVE), and insider access is already cut
      // because the auth rebind only honors ACTIVE memberships.
      return decide(input, 'ACTIVE', 'REVOKED', {}, 'revoke');
    },

    async listPendingForOrg(organizationId) {
      assertKey(organizationId, 'listPendingForOrg', 'organizationId');
      return withServiceRoleContext(db, async (tx) => {
        const rows = (await tx
          .select()
          .from(orgMemberships)
          .where(
            and(
              eq(orgMemberships.organizationId, organizationId),
              eq(orgMemberships.status, 'PENDING'),
            ),
          )
          .orderBy(asc(orgMemberships.joinedAt))) as unknown as MembershipRow[];
        return rows.map(rowToMembership);
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

    async block(input: BlockMembershipInput) {
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
