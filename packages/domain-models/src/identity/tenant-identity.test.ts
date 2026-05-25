import { describe, expect, it } from 'vitest';
import { asOrganizationId, asTenantId, asUserId } from '../common/types.js';
import {
  OrgMembershipStatus,
  asOrgMembershipId,
  asTenantIdentityId,
  findMembershipForOrg,
  isMembershipActive,
  type OrgMembership,
} from './tenant-identity.js';

function makeMembership(
  partial: Partial<OrgMembership> & { organizationId: OrgMembership['organizationId'] }
): OrgMembership {
  return {
    id: asOrgMembershipId('mem-' + partial.organizationId),
    tenantIdentityId: asTenantIdentityId('tid-1'),
    organizationId: partial.organizationId,
    platformTenantId: asTenantId('ptenant-1'),
    userId: asUserId('user-1'),
    joinedAt: '2026-01-01T00:00:00.000Z',
    joinedViaInviteCode: null,
    status: partial.status ?? OrgMembershipStatus.ACTIVE,
    nickname: partial.nickname ?? null,
  };
}

describe('tenant-identity helpers', () => {
  it('isMembershipActive returns true only for ACTIVE', () => {
    const orgId = asOrganizationId('org-1');
    expect(isMembershipActive(makeMembership({ organizationId: orgId }))).toBe(true);
    expect(
      isMembershipActive(
        makeMembership({ organizationId: orgId, status: OrgMembershipStatus.LEFT })
      )
    ).toBe(false);
    expect(
      isMembershipActive(
        makeMembership({ organizationId: orgId, status: OrgMembershipStatus.BLOCKED })
      )
    ).toBe(false);
  });

  it('findMembershipForOrg returns the first match regardless of status', () => {
    const orgA = asOrganizationId('org-a');
    const orgB = asOrganizationId('org-b');
    const list: readonly OrgMembership[] = [
      makeMembership({ organizationId: orgA, status: OrgMembershipStatus.LEFT }),
      makeMembership({ organizationId: orgB }),
    ];
    expect(findMembershipForOrg(list, orgA)?.organizationId).toBe(orgA);
    expect(findMembershipForOrg(list, orgB)?.organizationId).toBe(orgB);
    expect(findMembershipForOrg(list, asOrganizationId('missing'))).toBeUndefined();
  });
});
