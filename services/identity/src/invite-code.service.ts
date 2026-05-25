/**
 * InviteCodeService — generates, redeems, and revokes org-issued codes.
 *
 * Wires the Postgres repo so the three public methods return real results.
 * Code format is enforced at the repo layer: `<ORG_CODE>-<RANDOM_4>`
 * (e.g. `ACME-A3F9`).
 *
 * Redemption is the atomic chokepoint that creates an OrgMembership +
 * shadow User row + increments redemptions_used in a single transaction.
 *
 * See: Docs/analysis/CONFLICT_RESOLUTIONS.md § "Conflict 2".
 */

import type {
  ISOTimestamp,
  InviteAttachmentHints,
  InviteCode,
  InviteCodeRecord,
  OrgMembership,
  OrganizationId,
  RoleId,
  TenantIdentityId,
  UserId,
} from '@borjie/domain-models';
import type {
  PostgresInviteCodeRepository,
  RedeemerProfile,
} from './postgres-invite-code-repository.js';
import type { PostgresTenantIdentityRepository } from './postgres-tenant-identity-repository.js';

export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(`NOT_IMPLEMENTED: InviteCodeService.${methodName}`);
    this.name = 'NotImplementedError';
  }
}

export interface GenerateInviteOptions {
  readonly expiresAt?: ISOTimestamp;
  readonly maxRedemptions?: number;
  readonly defaultRoleId: RoleId;
  readonly attachmentHints?: InviteAttachmentHints;
}

export interface RedeemResult {
  readonly membership: OrgMembership;
  readonly code: InviteCodeRecord;
}

export interface InviteCodeServiceDeps {
  readonly inviteRepo?: PostgresInviteCodeRepository;
  readonly identityRepo?: PostgresTenantIdentityRepository;
}

export class InviteCodeService {
  private readonly inviteRepo?: PostgresInviteCodeRepository;
  private readonly identityRepo?: PostgresTenantIdentityRepository;

  constructor(deps: InviteCodeServiceDeps = {}) {
    this.inviteRepo = deps.inviteRepo;
    this.identityRepo = deps.identityRepo;
  }

  async generate(
    orgId: OrganizationId,
    issuedBy: UserId,
    opts: GenerateInviteOptions
  ): Promise<InviteCodeRecord> {
    if (!this.inviteRepo) {
      throw new NotImplementedError('generate');
    }
    return this.inviteRepo.generate(orgId, issuedBy, opts);
  }

  /**
   * Atomically redeem a code for a given TenantIdentity:
   *   1. Validate code (not expired, under max-redemptions, not revoked).
   *   2. Create shadow User row in the org's platform tenant.
   *   3. Create OrgMembership linking the identity to the org.
   *   4. Increment redemptionsUsed.
   *
   * All four steps commit or roll back together.
   */
  async redeem(
    code: InviteCode,
    tenantIdentityId: TenantIdentityId
  ): Promise<RedeemResult> {
    if (!this.inviteRepo || !this.identityRepo) {
      throw new NotImplementedError('redeem');
    }
    // nosemgrep: missing-tenant-id-arg reason: identities are globally-unique by tenantIdentityId; tenant scope is one of the columns on the identity row.
    const identity = await this.identityRepo.findById(tenantIdentityId);
    if (!identity) {
      throw new Error(`InviteCodeService.redeem: identity ${tenantIdentityId} not found`);
    }
    const redeemer: RedeemerProfile = {
      firstName: identity.profile.firstName,
      lastName: identity.profile.lastName,
      email: identity.email,
      phone: identity.profile.phone ?? identity.phoneNormalized,
    };
    return this.inviteRepo.redeem(code, tenantIdentityId, redeemer);
  }

  /**
   * Revoke an outstanding code. Future redeem attempts fail with
   * INVITE_CODE_REVOKED. Existing redemptions are unaffected.
   */
  async revoke(code: InviteCode): Promise<InviteCodeRecord> {
    if (!this.inviteRepo) {
      throw new NotImplementedError('revoke');
    }
    return this.inviteRepo.revoke(code);
  }
}
