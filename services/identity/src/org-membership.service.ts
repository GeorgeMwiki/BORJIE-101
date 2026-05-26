/**
 * OrgMembershipService — bridges TenantIdentity <-> User <-> Organization.
 *
 * Wires the Postgres repo so the three public methods return real results.
 * Every membership creation produces a 1:1 shadow User row in the target
 * platform tenant's users table — preserving RBAC, audit, and data-
 * isolation guarantees.
 *
 * See: Docs/analysis/CONFLICT_RESOLUTIONS.md § "Conflict 2".
 */

import type {
  InviteCode,
  OrgMembership,
  OrgMembershipId,
  OrganizationId,
  RoleId,
  TenantIdentityId,
} from '@borjie/domain-models';
import type { PostgresOrgMembershipRepository } from './postgres-org-membership-repository.js';
import type { PostgresTenantIdentityRepository } from './postgres-tenant-identity-repository.js';

export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(`NOT_IMPLEMENTED: OrgMembershipService.${methodName}`);
    this.name = 'NotImplementedError';
  }
}

export interface OrgMembershipServiceDeps {
  readonly membershipRepo?: PostgresOrgMembershipRepository;
  readonly identityRepo?: PostgresTenantIdentityRepository;
}

export class OrgMembershipService {
  private readonly membershipRepo: PostgresOrgMembershipRepository | undefined;
  private readonly identityRepo: PostgresTenantIdentityRepository | undefined;

  constructor(deps: OrgMembershipServiceDeps = {}) {
    this.membershipRepo = deps.membershipRepo;
    this.identityRepo = deps.identityRepo;
  }

  /**
   * Create a fresh membership for an identity in an org.
   *   1. Inserts a shadow `User` row in the org's platform tenant.
   *   2. Inserts the OrgMembership row pointing at the shadow User.
   *
   * Caller passes `viaCode` when the membership originated from an
   * invite-code redemption so it is stamped onto `joinedViaInviteCode`.
   */
  async createMembership(
    identityId: TenantIdentityId,
    orgId: OrganizationId,
    roleId: RoleId,
    viaCode?: InviteCode
  ): Promise<OrgMembership> {
    if (!this.membershipRepo || !this.identityRepo) {
      throw new NotImplementedError('createMembership');
    }
    // nosemgrep: missing-tenant-id-arg reason: identities are globally-unique by identityId; tenant scope is one of the columns on the identity row.
    const identity = await this.identityRepo.findById(identityId);
    if (!identity) {
      throw new Error(
        `OrgMembershipService.createMembership: identity ${identityId} not found`
      );
    }
    return this.membershipRepo.create({
      tenantIdentityId: identityId,
      organizationId: orgId,
      roleId,
      ...(viaCode !== undefined ? { viaCode } : {}),
      shadowProfile: {
        firstName: identity.profile.firstName,
        lastName: identity.profile.lastName,
        email: identity.email,
        phone: identity.profile.phone ?? identity.phoneNormalized,
      },
    });
  }

  /**
   * Tenant-initiated leave. Flips status -> LEFT and deactivates (not
   * deletes) the shadow User. Re-redeeming a code creates a fresh
   * membership row rather than resurrecting this one.
   */
  async leaveMembership(membershipId: OrgMembershipId): Promise<OrgMembership> {
    if (!this.membershipRepo) {
      throw new NotImplementedError('leaveMembership');
    }
    return this.membershipRepo.leave(membershipId);
  }

  /**
   * Admin-initiated block. Flips status -> BLOCKED with a reason recorded
   * on the audit trail. Shadow User is deactivated.
   */
  async blockMembership(
    membershipId: OrgMembershipId,
    reason: string
  ): Promise<OrgMembership> {
    if (!this.membershipRepo) {
      throw new NotImplementedError('blockMembership');
    }
    return this.membershipRepo.block(membershipId, reason);
  }
}
