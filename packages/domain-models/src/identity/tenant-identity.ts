/**
 * Cross-org tenant identity. Federates LOGIN across orgs; data isolation
 * preserved via shadow User rows per-org.
 *
 * TenantIdentity is a global, cross-organization identity principal keyed
 * by phone (+ optionally email). One real human => one TenantIdentity,
 * regardless of how many landlord organizations they rent from.
 *
 * OrgMembership is the per-org join record that links a TenantIdentity to
 * an organization. For every OrgMembership a shadow `User` row is created
 * in that organization's platform tenant, preserving RBAC, audit, and
 * data-isolation guarantees. All queries continue to filter by
 * `organizationId` through the existing RBAC pipeline — this module ONLY
 * federates login, not data.
 *
 * InviteCodeRecord is a redeemable code issued by an org admin; redeeming
 * creates an OrgMembership (and its shadow User row) atomically.
 *
 * Relationship to existing `User` entity:
 *   TenantIdentity  1 ─── N  OrgMembership  1 ─── 1  User (shadow, per-tenant)
 *
 * See: Docs/analysis/CONFLICT_RESOLUTIONS.md § "Conflict 2 — Universal Tenant App".
 */

import type {
  Brand,
  ISOTimestamp,
  OrganizationId,
  PropertyId,
  RoleId,
  TenantId,
  UnitId,
  UserId,
} from '../common/types.js';
import type { UserProfile } from './user.js';

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

/** Global cross-org identity ID. */
export type TenantIdentityId = Brand<string, 'TenantIdentityId'>;

/** Per-org membership row ID (join between TenantIdentity and Organization). */
export type OrgMembershipId = Brand<string, 'OrgMembershipId'>;

/** Redeemable invite code (opaque human-enterable string). */
export type InviteCode = Brand<string, 'InviteCode'>;

/** Cast a string to TenantIdentityId. */
export function asTenantIdentityId(id: string): TenantIdentityId {
  return id as TenantIdentityId;
}

/** Cast a string to OrgMembershipId. */
export function asOrgMembershipId(id: string): OrgMembershipId {
  return id as OrgMembershipId;
}

/** Cast a string to InviteCode. */
export function asInviteCode(code: string): InviteCode {
  return code as InviteCode;
}

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

/** Lifecycle states for a TenantIdentity principal. */
export const TenantIdentityStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;

export type TenantIdentityStatus =
  (typeof TenantIdentityStatus)[keyof typeof TenantIdentityStatus];

/** Lifecycle states for a per-org membership. */
export const OrgMembershipStatus = {
  ACTIVE: 'ACTIVE',
  LEFT: 'LEFT',
  BLOCKED: 'BLOCKED',
} as const;

export type OrgMembershipStatus =
  (typeof OrgMembershipStatus)[keyof typeof OrgMembershipStatus];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * Cross-org identity. One per real human, regardless of landlord count.
 * Lives in a root identity service — NOT scoped to any BORJIE platform tenant.
 */
export interface TenantIdentity {
  readonly id: TenantIdentityId;
  /** ITU-T E.164 normalized phone (digits only, no '+'). */
  readonly phoneNormalized: string;
  /** ISO 3166-1 alpha-2 country code used to normalize the phone. */
  readonly phoneCountryCode: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly profile: UserProfile;
  readonly createdAt: ISOTimestamp;
  readonly lastActivityAt: ISOTimestamp | null;
  readonly status: TenantIdentityStatus;
}

/**
 * Per-org join record. For every OrgMembership there is a shadow User row
 * in the corresponding platform-tenant's user table — identified by `userId`.
 */
export interface OrgMembership {
  readonly id: OrgMembershipId;
  readonly tenantIdentityId: TenantIdentityId;
  readonly organizationId: OrganizationId;
  readonly platformTenantId: TenantId;
  /** Bridging row in per-tenant User table (shadow user). */
  readonly userId: UserId;
  readonly joinedAt: ISOTimestamp;
  readonly joinedViaInviteCode: InviteCode | null;
  readonly status: OrgMembershipStatus;
  /** Human-friendly label the tenant set for this org (e.g. "Acme apartments"). */
  readonly nickname: string | null;
}

/** Optional pre-binding hints attached to an invite code. */
export interface InviteAttachmentHints {
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
}

/**
 * Redeemable code issued by an org admin. Redemption creates an
 * OrgMembership and shadow User row atomically.
 */
export interface InviteCodeRecord {
  readonly code: InviteCode;
  readonly organizationId: OrganizationId;
  readonly platformTenantId: TenantId;
  readonly issuedBy: UserId;
  readonly issuedAt: ISOTimestamp;
  readonly expiresAt: ISOTimestamp | null;
  readonly maxRedemptions: number | null;
  readonly redemptionsUsed: number;
  readonly defaultRoleId: RoleId;
  readonly attachmentHints?: InviteAttachmentHints;
}

// ---------------------------------------------------------------------------
// Helpers (pure functions — no I/O)
// ---------------------------------------------------------------------------

/** True iff the membership is in the ACTIVE state. */
export function isMembershipActive(m: OrgMembership): boolean {
  return m.status === OrgMembershipStatus.ACTIVE;
}

/**
 * Find the (first) membership that binds the given identity to the given
 * organization. Returns undefined when no match exists. Does NOT filter by
 * status — callers compose with `isMembershipActive` when needed.
 */
export function findMembershipForOrg(
  memberships: readonly OrgMembership[],
  orgId: OrganizationId
): OrgMembership | undefined {
  return memberships.find((m) => m.organizationId === orgId);
}
