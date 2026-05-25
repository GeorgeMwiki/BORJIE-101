/**
 * Tests for OrgMembershipService wired to fake repos.
 */

import { describe, it, expect } from 'vitest';
import { OrgMembershipService } from '../org-membership.service.js';
import type { PostgresOrgMembershipRepository } from '../postgres-org-membership-repository.js';
import type { PostgresTenantIdentityRepository } from '../postgres-tenant-identity-repository.js';
import type {
  InviteCode,
  OrgMembership,
  OrgMembershipId,
  OrganizationId,
  RoleId,
  TenantIdentity,
  TenantIdentityId,
} from '@borjie/domain-models';

function makeIdentity(id: string): TenantIdentity {
  return {
    id: id as unknown as TenantIdentityId,
    phoneNormalized: '255712345678',
    phoneCountryCode: 'TZ',
    email: null,
    emailVerified: false,
    profile: {
      firstName: 'C',
      lastName: 'D',
      displayName: 'C D',
      avatarUrl: null,
      phone: '255712345678',
      timezone: 'UTC',
      locale: 'en',
    },
    status: 'ACTIVE',
    createdAt: new Date().toISOString() as TenantIdentity['createdAt'],
    lastActivityAt: null,
  };
}

describe('OrgMembershipService (wired)', () => {
  it('createMembership forwards the identity profile to the repo', async () => {
    let seen: unknown = null;
    const membershipRepo = {
      async create(input: unknown) {
        seen = input;
        return {} as OrgMembership;
      },
    } as unknown as PostgresOrgMembershipRepository;
    const identityRepo = {
      async findById() {
        return makeIdentity('tid_1');
      },
    } as unknown as PostgresTenantIdentityRepository;
    const svc = new OrgMembershipService({ membershipRepo, identityRepo });
    await svc.createMembership(
      'tid_1' as TenantIdentityId,
      'org_1' as OrganizationId,
      'role_tenant' as RoleId,
      'ACME-ABCD' as InviteCode
    );
    expect(seen).toMatchObject({
      tenantIdentityId: 'tid_1',
      organizationId: 'org_1',
      roleId: 'role_tenant',
      viaCode: 'ACME-ABCD',
      shadowProfile: {
        firstName: 'C',
        lastName: 'D',
        phone: '255712345678',
      },
    });
  });

  it('createMembership throws when the identity is unknown', async () => {
    const membershipRepo = {
      create: async () => ({ }) as OrgMembership,
    } as unknown as PostgresOrgMembershipRepository;
    const identityRepo = {
      async findById() {
        return null;
      },
    } as unknown as PostgresTenantIdentityRepository;
    const svc = new OrgMembershipService({ membershipRepo, identityRepo });
    await expect(
      svc.createMembership(
        'tid_nope' as TenantIdentityId,
        'org_1' as OrganizationId,
        'role_tenant' as RoleId
      )
    ).rejects.toThrow(/identity .* not found/);
  });

  it('leaveMembership delegates to membershipRepo.leave', async () => {
    let calledWith: unknown = null;
    const membershipRepo = {
      async leave(id: OrgMembershipId) {
        calledWith = id;
        return {} as OrgMembership;
      },
    } as unknown as PostgresOrgMembershipRepository;
    const svc = new OrgMembershipService({
      membershipRepo,
      identityRepo: {
        async findById() {
          return null;
        },
      } as unknown as PostgresTenantIdentityRepository,
    });
    await svc.leaveMembership('mem_1' as OrgMembershipId);
    expect(calledWith).toBe('mem_1');
  });

  it('blockMembership delegates with the reason', async () => {
    let captured: unknown = null;
    const membershipRepo = {
      async block(id: OrgMembershipId, reason: string) {
        captured = { id, reason };
        return {} as OrgMembership;
      },
    } as unknown as PostgresOrgMembershipRepository;
    const svc = new OrgMembershipService({
      membershipRepo,
      identityRepo: {
        async findById() {
          return null;
        },
      } as unknown as PostgresTenantIdentityRepository,
    });
    await svc.blockMembership('mem_1' as OrgMembershipId, 'fraud');
    expect(captured).toEqual({ id: 'mem_1', reason: 'fraud' });
  });

  it('without deps, every method still throws NOT_IMPLEMENTED', async () => {
    const svc = new OrgMembershipService();
    await expect(
      svc.createMembership(
        'tid_1' as TenantIdentityId,
        'org_1' as OrganizationId,
        'role_tenant' as RoleId
      )
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(
      svc.leaveMembership('mem_1' as OrgMembershipId)
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(
      svc.blockMembership('mem_1' as OrgMembershipId, 'reason')
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
