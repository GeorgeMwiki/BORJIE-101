/**
 * Stub sanity tests for InviteCodeService. See sibling test for the
 * pattern and replacement plan.
 */

import { describe, expect, it } from 'vitest';
import { InviteCodeService } from '../invite-code.service.js';
import type {
  InviteCode,
  OrganizationId,
  RoleId,
  TenantIdentityId,
  UserId,
} from '@borjie/domain-models';

describe('InviteCodeService (stub)', () => {
  const svc = new InviteCodeService();

  it('defines every required method on the prototype', () => {
    const methods: ReadonlyArray<keyof InviteCodeService> = [
      'generate',
      'redeem',
      'revoke',
    ];
    for (const m of methods) {
      expect(typeof svc[m]).toBe('function');
    }
  });

  it('generate accepts (orgId, issuedBy, opts) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.generate.length).toBe(3);
    await expect(
      svc.generate('org-1' as OrganizationId, 'user-1' as UserId, {
        defaultRoleId: 'role-1' as RoleId,
      })
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('redeem accepts (code, tenantIdentityId) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.redeem.length).toBe(2);
    await expect(
      svc.redeem('ACME-A3F9' as InviteCode, 'tid-1' as TenantIdentityId)
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('revoke accepts (code) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.revoke.length).toBe(1);
    await expect(svc.revoke('ACME-A3F9' as InviteCode)).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
  });
});
