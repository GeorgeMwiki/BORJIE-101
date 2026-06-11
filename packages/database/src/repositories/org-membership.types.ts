/**
 * OrgMembership domain types — shared by the Drizzle implementation
 * (org-membership.repository.ts) and the in-memory twin
 * (org-membership.memory.ts).
 *
 * THE CORRECTED BUYER MODEL (migration 0345): BUYER ≠ TENANT-INSIDER.
 * buyer_connection rows NEVER carry a shadow user_id (a buyer is an external
 * counterparty — no `users` row in the seller tenant, ever); employment-class
 * rows (employment|contractor|guest) MUST carry one WHEN ACTIVE (insider
 * authz resolves through users + RLS), and may be NULL while non-ACTIVE (a
 * PENDING public-discovery request is not provisioned an insider user until
 * the org approves). The DB CHECK `org_memberships_buyer_no_shadow_user`
 * pins this; `assertShadowUserInvariant` mirrors it at the type layer so
 * both implementations fail loud BEFORE the database does.
 *
 * THE PAIRING STATE MACHINE (migration 0345):
 *   invite/QR redeem  → ACTIVE      (org pre-authorized by issuing the code)
 *   public request    → PENDING     (org `discoverable` opt-in gates this)
 *   approve           PENDING → ACTIVE   (shadow user provisioned here for
 *                                         employment-class)
 *   reject            PENDING → REJECTED
 *   revoke            ACTIVE  → REVOKED  (org-initiated; vs LEFT = member-)
 *   leave             ACTIVE  → LEFT
 *   re-request        LEFT|REJECTED|REVOKED → PENDING
 *   block             any → BLOCKED      (terminal until org unblocks)
 */

export type OrgMembershipStatus =
  | 'ACTIVE'
  | 'LEFT'
  | 'BLOCKED'
  | 'PENDING'
  | 'REJECTED'
  | 'REVOKED';

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
  /** NULL for every buyer_connection row + non-ACTIVE employment rows. */
  readonly userId: string | null;
  readonly status: OrgMembershipStatus;
  readonly relationshipType: OrgMembershipRelationshipType;
  readonly memberRole: string | null;
  readonly nickname: string | null;
  readonly joinedViaInviteCode: string | null;
  readonly joinedAtMs: number;
  readonly leftAtMs: number | null;
  readonly blockedAtMs: number | null;
  /** Pairing mode (b) — the requester's note on a public-discovery request. */
  readonly requestedNote: string | null;
  /** Approval audit — the org-side decider (soft users.id reference). */
  readonly decidedBy: string | null;
  readonly decidedAtMs: number | null;
  readonly decisionNote: string | null;
}

/** CONNECT input — an org-initiated direct join (add a worker, link a buyer). */
export interface ConnectMembershipInput {
  readonly tenantIdentityId: string;
  readonly organizationId: string;
  readonly platformTenantId: string;
  /**
   * The shadow user row (provisioned upstream — see the SEAM note).
   * REQUIRED for employment-class; FORBIDDEN for buyer_connection.
   */
  readonly userId?: string | null;
  readonly relationshipType: OrgMembershipRelationshipType;
  readonly memberRole?: string | null;
  readonly nickname?: string | null;
}

/**
 * REDEEM input — consume an invite_code into a membership atomically.
 * The relationship is derived from the INVITE row (trust-direction fix:
 * never from the redeemer). The caller peeks the invite first
 * (`peekInvite`) to know whether a shadow user must be provisioned.
 */
export interface RedeemInviteInput {
  readonly code: string;
  readonly tenantIdentityId: string;
  /**
   * The shadow user row in the invite's platform tenant. REQUIRED when the
   * invite grants employment-class; FORBIDDEN for a buyer invite.
   */
  readonly userId?: string | null;
  readonly nickname?: string | null;
}

export interface RedeemInviteResult {
  readonly membership: OrgMembership;
  readonly organizationId: string;
  readonly platformTenantId: string;
}

/** Read-only invite view so the route can provision BEFORE redeeming. */
export interface InvitePeek {
  readonly code: string;
  readonly organizationId: string;
  readonly platformTenantId: string;
  readonly relationshipType: OrgMembershipRelationshipType;
  readonly defaultRoleId: string;
  /** Live = not revoked, not expired, redemptions remaining. */
  readonly redeemable: boolean;
}

/** REQUEST input — pairing mode (b): worker/buyer asks, org decides. */
export interface RequestPairingInput {
  readonly tenantIdentityId: string;
  readonly organizationId: string;
  readonly platformTenantId: string;
  readonly relationshipType: OrgMembershipRelationshipType;
  readonly memberRole?: string | null;
  readonly nickname?: string | null;
  readonly requestedNote?: string | null;
}

/** DECIDE input — approve / reject (PENDING) or revoke (ACTIVE). */
export interface DecideMembershipInput {
  readonly organizationId: string;
  readonly membershipId: string;
  /** The org-side decider (users.id; soft reference, audit only). */
  readonly decidedBy: string;
  readonly decisionNote?: string | null;
}

/** APPROVE adds the shadow user for employment-class rows. */
export interface ApproveMembershipInput extends DecideMembershipInput {
  /**
   * REQUIRED when the pending row is employment-class (provisioned by the
   * route just before approval); FORBIDDEN for buyer_connection.
   */
  readonly userId?: string | null;
}

/** BLOCK input — an org blocks one of its members. */
export interface BlockMembershipInput {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly reason?: string | null;
}

/** ISSUE input — an org mints an invite code (pairing mode a). */
export interface CreateInviteInput {
  readonly organizationId: string;
  readonly platformTenantId: string;
  /** users.id of the org-side issuer. */
  readonly issuedBy: string;
  /** Targeting label granted at redeem (member_role source). */
  readonly defaultRoleId: string;
  /** The relationship the invite grants. Defaults 'employment'. */
  readonly relationshipType?: OrgMembershipRelationshipType;
  readonly expiresAt?: Date | null;
  readonly maxRedemptions?: number | null;
}

/** A relationship/role-class predicate the audience resolver fans over. */
export interface AudienceQuery {
  readonly relationshipType?: OrgMembershipRelationshipType;
  /** Role-class targeting (member_role IN ...). Empty/undefined = any role. */
  readonly memberRoles?: ReadonlyArray<string>;
}

export interface OrgMembershipRepository {
  /** Direct org-initiated join (idempotent on (identity, org); reactivates a
   *  non-BLOCKED row; a BLOCKED row is returned unchanged). */
  connect(input: ConnectMembershipInput): Promise<OrgMembership>;
  /** Atomically consume an invite_code → a membership in the invite's org. */
  redeemInvite(input: RedeemInviteInput): Promise<RedeemInviteResult>;
  /** Read-only invite lookup (org/tenant/relationship) — null if unknown. */
  peekInvite(code: string): Promise<InvitePeek | null>;
  /** Mint an invite code for an org (pairing mode a; QR encodes the code). */
  createInvite(input: CreateInviteInput): Promise<InvitePeek>;
  /** Pairing mode (b): create/refresh a PENDING request (re-request from
   *  LEFT|REJECTED|REVOKED; ACTIVE and BLOCKED rows returned unchanged). */
  requestPairing(input: RequestPairingInput): Promise<OrgMembership>;
  /** PENDING → ACTIVE. Null when no PENDING row matches. */
  approve(input: ApproveMembershipInput): Promise<OrgMembership | null>;
  /** PENDING → REJECTED. Null when no PENDING row matches. */
  reject(input: DecideMembershipInput): Promise<OrgMembership | null>;
  /** ACTIVE → REVOKED (org-initiated). Null when no ACTIVE row matches. */
  revoke(input: DecideMembershipInput): Promise<OrgMembership | null>;
  /** The org's approval queue, oldest first. */
  listPendingForOrg(
    organizationId: string,
  ): Promise<ReadonlyArray<OrgMembership>>;
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
  /** Leave one of your own memberships (ACTIVE → LEFT). Null if none. */
  leave(
    tenantIdentityId: string,
    organizationId: string,
  ): Promise<OrgMembership | null>;
  /** An org blocks a member (any status → BLOCKED). Null if not found. */
  block(input: BlockMembershipInput): Promise<OrgMembership | null>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Typed redemption failure so the route can map it to a 4xx, not a 500. */
export class InviteRedemptionError extends Error {
  readonly code = 'INVITE_NOT_REDEEMABLE';
  constructor(message: string) {
    super(message);
    this.name = 'InviteRedemptionError';
  }
}

/** The shadow-user invariant tripped at the type layer (caller bug). */
export class MembershipInvariantError extends Error {
  readonly code: 'SHADOW_USER_REQUIRED' | 'SHADOW_USER_FORBIDDEN';
  constructor(
    code: 'SHADOW_USER_REQUIRED' | 'SHADOW_USER_FORBIDDEN',
    message: string,
  ) {
    super(message);
    this.name = 'MembershipInvariantError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Shared validation + mapping
// ---------------------------------------------------------------------------

/**
 * Defence-in-depth key assert. Every method runs under the service-role RLS
 * BYPASS, so an empty key param could otherwise become a silent over-read.
 */
export function assertKey(value: string, op: string, name: string): void {
  if (!value) {
    throw new Error(`org-membership: ${op} requires a non-empty ${name}`);
  }
}

/**
 * Mirror of the DB CHECK `org_memberships_buyer_no_shadow_user` for rows
 * being written as ACTIVE: buyers never carry a shadow user; ACTIVE
 * employment-class rows always do.
 */
export function assertShadowUserInvariant(
  relationshipType: OrgMembershipRelationshipType,
  userId: string | null | undefined,
  op: string,
): string | null {
  if (relationshipType === 'buyer_connection') {
    if (userId) {
      throw new MembershipInvariantError(
        'SHADOW_USER_FORBIDDEN',
        `org-membership: ${op} must not carry a shadow userId for a ` +
          'buyer_connection — a buyer is an external counterparty, never a ' +
          'tenant insider.',
      );
    }
    return null;
  }
  if (!userId) {
    throw new MembershipInvariantError(
      'SHADOW_USER_REQUIRED',
      `org-membership: ${op} requires the shadow userId for an ACTIVE ` +
        `${relationshipType} membership (insider authz resolves via users + RLS).`,
    );
  }
  return userId;
}

export function membershipMs(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

export interface MembershipRow {
  id: string;
  tenantIdentityId: string;
  organizationId: string;
  platformTenantId: string;
  userId: string | null;
  status: OrgMembershipStatus;
  relationshipType: OrgMembershipRelationshipType;
  memberRole: string | null;
  nickname: string | null;
  joinedViaInviteCode: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  blockedAt: Date | null;
  blockReason: string | null;
  requestedNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export function rowToMembership(row: MembershipRow): OrgMembership {
  return Object.freeze({
    id: row.id,
    tenantIdentityId: row.tenantIdentityId,
    organizationId: row.organizationId,
    platformTenantId: row.platformTenantId,
    userId: row.userId ?? null,
    status: row.status,
    relationshipType: row.relationshipType,
    memberRole: row.memberRole ?? null,
    nickname: row.nickname ?? null,
    joinedViaInviteCode: row.joinedViaInviteCode ?? null,
    joinedAtMs: row.joinedAt.getTime(),
    leftAtMs: membershipMs(row.leftAt),
    blockedAtMs: membershipMs(row.blockedAt),
    requestedNote: row.requestedNote ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedAtMs: membershipMs(row.decidedAt),
    decisionNote: row.decisionNote ?? null,
  });
}
