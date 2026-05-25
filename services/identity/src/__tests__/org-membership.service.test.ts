/**
 * Stub sanity tests for OrgMembershipService. See sibling test for the
 * pattern and replacement plan.
 */

import { describe, expect, it } from 'vitest';
import { OrgMembershipService } from '../org-membership.service.js';
import type {
  InviteCode,
  OrgMembershipId,
  OrganizationId,
  RoleId,
  TenantIdentityId,
} from '@borjie/domain-models';

describe('OrgMembershipService (stub)', () => {
  const svc = new OrgMembershipService();

  it('defines every required method on the prototype', () => {
    const methods: ReadonlyArray<keyof OrgMembershipService> = [
      'createMembership',
      'leaveMembership',
      'blockMembership',
    ];
    for (const m of methods) {
      expect(typeof svc[m]).toBe('function');
    }
  });

  it('createMembership accepts (identityId, orgId, roleId, viaCode?) and rejects NOT_IMPLEMENTED', async () => {
    // TS-compiled optional params still appear in Function.length
    expect(svc.createMembership.length).toBe(4);
    await expect(
      svc.createMembership(
        'tid-1' as TenantIdentityId,
        'org-1' as OrganizationId,
        'role-1' as RoleId,
        'CODE-1' as InviteCode
      )
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('leaveMembership accepts (membershipId) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.leaveMembership.length).toBe(1);
    await expect(
      svc.leaveMembership('mem-1' as OrgMembershipId)
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('blockMembership accepts (membershipId, reason) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.blockMembership.length).toBe(2);
    await expect(
      svc.blockMembership('mem-1' as OrgMembershipId, 'fraud')
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
