/**
 * TenantIdentityService — global cross-org identity management.
 *
 * Wires the Postgres repo and the OTP service so the four public methods
 * return real results:
 *
 *   - createOrUpsertByPhone: normalize phone, find-or-create the identity.
 *   - verifyPhoneOTP:        consume a pending OTP, touch last_activity.
 *   - getMemberships:        delegate to the membership repo.
 *   - mergeDuplicates:       transactional re-parenting via the identity repo.
 *
 * Callers supply concrete repos at construction time. A zero-arg
 * constructor is kept for backwards compatibility with existing stub tests;
 * it throws the same NOT_IMPLEMENTED error those tests already assert on.
 *
 * See: Docs/analysis/CONFLICT_RESOLUTIONS.md § "Conflict 2".
 */

import type {
  OrgMembership,
  TenantIdentity,
  TenantIdentityId,
  UserProfile,
} from '@borjie/domain-models';
import type { PostgresTenantIdentityRepository } from './postgres-tenant-identity-repository.js';
import type { PostgresOrgMembershipRepository } from './postgres-org-membership-repository.js';
import type { OtpService } from './otp/otp-service.js';
import { normalizePhoneForCountry } from './phone-normalize.js';

/** Error thrown when the service is used without its dependencies wired. */
export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(`NOT_IMPLEMENTED: TenantIdentityService.${methodName}`);
    this.name = 'NotImplementedError';
  }
}

/** Result of an OTP verification attempt. */
export interface VerifyOtpResult {
  readonly verified: boolean;
  readonly identity: TenantIdentity | null;
}

/** Dependencies injected into the service. All optional for stub-era tests. */
export interface TenantIdentityServiceDeps {
  readonly identityRepo?: PostgresTenantIdentityRepository;
  readonly membershipRepo?: PostgresOrgMembershipRepository;
  readonly otpService?: OtpService;
  readonly defaultProfile?: UserProfile;
}

const EMPTY_PROFILE: UserProfile = {
  firstName: '',
  lastName: '',
  displayName: '',
  avatarUrl: null,
  phone: null,
  timezone: 'UTC',
  locale: 'en',
};

export class TenantIdentityService {
  private readonly identityRepo: PostgresTenantIdentityRepository | undefined;
  private readonly membershipRepo: PostgresOrgMembershipRepository | undefined;
  private readonly otpService: OtpService | undefined;
  private readonly defaultProfile: UserProfile;

  constructor(deps: TenantIdentityServiceDeps = {}) {
    this.identityRepo = deps.identityRepo;
    this.membershipRepo = deps.membershipRepo;
    this.otpService = deps.otpService;
    this.defaultProfile = deps.defaultProfile ?? EMPTY_PROFILE;
  }

  /**
   * Create or upsert a TenantIdentity for the given phone + country code.
   * Phone is normalized through `normalizePhoneForCountry` before lookup.
   */
  async createOrUpsertByPhone(
    phone: string,
    countryCode: string
  ): Promise<TenantIdentity> {
    if (!this.identityRepo) {
      throw new NotImplementedError('createOrUpsertByPhone');
    }
    const normalized = normalizePhoneForCountry(phone, countryCode);
    const existing = await this.identityRepo.findByPhone(
      normalized,
      countryCode
    );
    if (existing) {
      return existing;
    }
    return this.identityRepo.create({
      phoneNormalized: normalized,
      phoneCountryCode: countryCode,
      profile: {
        ...this.defaultProfile,
        phone,
      },
    });
  }

  /**
   * Verify an OTP code previously sent to the identity's phone.
   * Returns the identity on success so the caller can mint a session.
   */
  async verifyPhoneOTP(
    identityId: TenantIdentityId,
    code: string
  ): Promise<VerifyOtpResult> {
    if (!this.identityRepo || !this.otpService) {
      throw new NotImplementedError('verifyPhoneOTP');
    }
    const result = await this.otpService.verify(identityId, code);
    if (!result.verified) {
      return { verified: false, identity: null };
    }
    await this.identityRepo.touchActivity(identityId);
    // nosemgrep: missing-tenant-id-arg reason: identities are globally-unique by identityId; tenant scope is one of the columns on the identity row.
    const identity = await this.identityRepo.findById(identityId);
    return { verified: true, identity };
  }

  /**
   * Return every OrgMembership attached to this identity.
   * Callers filter by status via `isMembershipActive`.
   */
  async getMemberships(
    identityId: TenantIdentityId
  ): Promise<readonly OrgMembership[]> {
    if (!this.membershipRepo) {
      throw new NotImplementedError('getMemberships');
    }
    return this.membershipRepo.findByIdentity(identityId);
  }

  /**
   * Merge duplicate identities surfaced by phone-backfill migration.
   * All memberships on `duplicateId` are re-parented to `primaryId` and
   * the duplicate is deactivated. Atomic; logged via the repo layer.
   */
  async mergeDuplicates(
    primaryId: TenantIdentityId,
    duplicateId: TenantIdentityId
  ): Promise<TenantIdentity> {
    if (!this.identityRepo) {
      throw new NotImplementedError('mergeDuplicates');
    }
    return this.identityRepo.merge(primaryId, duplicateId);
  }
}
