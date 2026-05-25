/**
 * Tests for TenantIdentityService when wired to real collaborators.
 *
 * We inject hand-rolled fakes for the two repos and the OTP service so we
 * can exercise the service's orchestration without a live database.
 */

import { describe, it, expect } from 'vitest';
import { TenantIdentityService } from '../tenant-identity.service.js';
import type { PostgresTenantIdentityRepository } from '../postgres-tenant-identity-repository.js';
import type { PostgresOrgMembershipRepository } from '../postgres-org-membership-repository.js';
import type { OtpService, OtpVerifyResult } from '../otp/otp-service.js';
import type {
  OrgMembership,
  TenantIdentity,
  TenantIdentityId,
  UserProfile,
} from '@borjie/domain-models';

const PROFILE: UserProfile = {
  firstName: 'Amina',
  lastName: 'Khamis',
  displayName: 'Amina Khamis',
  avatarUrl: null,
  phone: '+255712345678',
  timezone: 'Africa/Dar_es_Salaam',
  locale: 'sw',
};

function makeFakeIdentityRepo() {
  const byId = new Map<string, TenantIdentity>();
  const byPhone = new Map<string, TenantIdentity>();
  let counter = 0;
  const repo = {
    async findByPhone(phoneNormalized: string) {
      return byPhone.get(phoneNormalized) ?? null;
    },
    async findById(id: TenantIdentityId) {
      return byId.get(id as unknown as string) ?? null;
    },
    async create(input: {
      phoneNormalized: string;
      phoneCountryCode: string;
      profile: UserProfile;
    }) {
      counter += 1;
      const id = `tid_${counter}` as TenantIdentityId;
      const identity: TenantIdentity = {
        id,
        phoneNormalized: input.phoneNormalized,
        phoneCountryCode: input.phoneCountryCode,
        email: null,
        emailVerified: false,
        profile: input.profile,
        status: 'ACTIVE',
        createdAt: new Date().toISOString() as TenantIdentity['createdAt'],
        lastActivityAt: null,
      };
      byId.set(id as unknown as string, identity);
      byPhone.set(input.phoneNormalized, identity);
      return identity;
    },
    async touchActivity() {
      /* no-op for tests */
    },
    async merge() {
      throw new Error('not used');
    },
    async update() {
      throw new Error('not used');
    },
  };
  return repo as unknown as PostgresTenantIdentityRepository;
}

function makeFakeMembershipRepo(memberships: readonly OrgMembership[] = []) {
  return {
    async findByIdentity() {
      return memberships;
    },
  } as unknown as PostgresOrgMembershipRepository;
}

function makeFakeOtp(result: OtpVerifyResult) {
  return {
    async verify() {
      return result;
    },
    async send() {
      return { expiresAt: Date.now() + 300_000 };
    },
  } as unknown as OtpService;
}

describe('TenantIdentityService (wired)', () => {
  it('createOrUpsertByPhone creates a new identity on first call and returns it on the second', async () => {
    const identityRepo = makeFakeIdentityRepo();
    const svc = new TenantIdentityService({
      identityRepo,
      defaultProfile: PROFILE,
    });
    const first = await svc.createOrUpsertByPhone('0712345678', 'TZ');
    expect(first.phoneNormalized).toBe('255712345678');
    const second = await svc.createOrUpsertByPhone('+255712345678', 'TZ');
    expect(second.id).toBe(first.id);
  });

  it('verifyPhoneOTP returns the identity when the OTP service accepts', async () => {
    const identityRepo = makeFakeIdentityRepo();
    const svc = new TenantIdentityService({
      identityRepo,
      otpService: makeFakeOtp({ verified: true }),
      defaultProfile: PROFILE,
    });
    const identity = await svc.createOrUpsertByPhone('0712345678', 'TZ');
    const result = await svc.verifyPhoneOTP(identity.id, '123456');
    expect(result.verified).toBe(true);
    expect(result.identity?.id).toBe(identity.id);
  });

  it('verifyPhoneOTP returns verified=false when the OTP service rejects', async () => {
    const identityRepo = makeFakeIdentityRepo();
    const svc = new TenantIdentityService({
      identityRepo,
      otpService: makeFakeOtp({ verified: false, reason: 'EXPIRED' }),
    });
    const result = await svc.verifyPhoneOTP(
      'tid_nope' as TenantIdentityId,
      '000000'
    );
    expect(result).toEqual({ verified: false, identity: null });
  });

  it('getMemberships delegates to the membership repo', async () => {
    const identityRepo = makeFakeIdentityRepo();
    const memberships = [
      { id: 'mem-1' },
      { id: 'mem-2' },
    ] as unknown as readonly OrgMembership[];
    const svc = new TenantIdentityService({
      identityRepo,
      membershipRepo: makeFakeMembershipRepo(memberships),
    });
    const out = await svc.getMemberships('tid_1' as TenantIdentityId);
    expect(out).toHaveLength(2);
  });

  it('without deps, every method still throws NOT_IMPLEMENTED (backwards compat)', async () => {
    const svc = new TenantIdentityService();
    await expect(svc.createOrUpsertByPhone('0712345678', 'TZ')).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
    await expect(
      svc.verifyPhoneOTP('tid_1' as TenantIdentityId, '000000')
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(
      svc.getMemberships('tid_1' as TenantIdentityId)
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(
      svc.mergeDuplicates(
        'tid_1' as TenantIdentityId,
        'tid_2' as TenantIdentityId
      )
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
