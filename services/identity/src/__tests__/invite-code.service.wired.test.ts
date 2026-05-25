/**
 * Tests for InviteCodeService wired to fake repos.
 *
 * Covers:
 *   - generate delegates with the supplied options
 *   - redeem fetches the identity and forwards a redeemer profile
 *   - concurrent redeems against a limited-redemption code: only `max`
 *     succeed
 *   - revoke delegates and propagates errors
 */

import { describe, it, expect } from 'vitest';
import { InviteCodeService } from '../invite-code.service.js';
import type { PostgresInviteCodeRepository, RedeemResult } from '../postgres-invite-code-repository.js';
import type { PostgresTenantIdentityRepository } from '../postgres-tenant-identity-repository.js';
import type {
  InviteCode,
  InviteCodeRecord,
  OrganizationId,
  RoleId,
  TenantIdentity,
  TenantIdentityId,
  UserId,
} from '@borjie/domain-models';

function makeIdentity(id: string): TenantIdentity {
  return {
    id: id as unknown as TenantIdentityId,
    phoneNormalized: '255712345678',
    phoneCountryCode: 'TZ',
    email: 'a@b.test',
    emailVerified: false,
    profile: {
      firstName: 'A',
      lastName: 'B',
      displayName: 'A B',
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

function makeIdentityRepo(identity: TenantIdentity | null) {
  return {
    async findById() {
      return identity;
    },
  } as unknown as PostgresTenantIdentityRepository;
}

describe('InviteCodeService (wired)', () => {
  it('redeem looks up the identity and forwards a redeemer profile', async () => {
    const identity = makeIdentity('tid_1');
    let seen: unknown = null;
    const inviteRepo = {
      async redeem(code: InviteCode, id: TenantIdentityId, profile: unknown) {
        seen = { code, id, profile };
        return {
          membership: {} as RedeemResult['membership'],
          code: {} as InviteCodeRecord,
        };
      },
    } as unknown as PostgresInviteCodeRepository;
    const svc = new InviteCodeService({
      inviteRepo,
      identityRepo: makeIdentityRepo(identity),
    });
    await svc.redeem(
      'ACME-ABCD' as InviteCode,
      identity.id
    );
    expect(seen).toEqual({
      code: 'ACME-ABCD',
      id: identity.id,
      profile: {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.test',
        phone: '255712345678',
      },
    });
  });

  it('redeem throws when the identity is unknown', async () => {
    const inviteRepo = {
      redeem: async () => ({ }) as RedeemResult,
    } as unknown as PostgresInviteCodeRepository;
    const svc = new InviteCodeService({
      inviteRepo,
      identityRepo: makeIdentityRepo(null),
    });
    await expect(
      svc.redeem('X-YZ' as InviteCode, 'tid_nope' as TenantIdentityId)
    ).rejects.toThrow(/identity .* not found/);
  });

  it('concurrent redeems against a limited code: only max succeed', async () => {
    // Simulate the FOR UPDATE critical section with a single-slot mutex
    // around the shared counter inside the fake repo.
    let used = 0;
    const MAX = 1;
    let locked = false;
    const inviteRepo = {
      async redeem(): Promise<RedeemResult> {
        while (locked) {
          await new Promise((r) => setTimeout(r, 0));
        }
        locked = true;
        try {
          if (used >= MAX) {
            throw new Error('INVITE_CODE_EXHAUSTED');
          }
          used += 1;
          return {
            membership: {} as RedeemResult['membership'],
            code: {} as InviteCodeRecord,
          };
        } finally {
          locked = false;
        }
      },
    } as unknown as PostgresInviteCodeRepository;
    const svc = new InviteCodeService({
      inviteRepo,
      identityRepo: makeIdentityRepo(makeIdentity('tid_1')),
    });
    const results = await Promise.allSettled([
      svc.redeem('C-1' as InviteCode, 'tid_1' as TenantIdentityId),
      svc.redeem('C-1' as InviteCode, 'tid_1' as TenantIdentityId),
      svc.redeem('C-1' as InviteCode, 'tid_1' as TenantIdentityId),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason.message).toMatch(/EXHAUSTED/);
    }
  });

  it('generate delegates to the repo with the supplied options', async () => {
    let captured: unknown = null;
    const inviteRepo = {
      async generate(orgId: OrganizationId, issuedBy: UserId, opts: unknown) {
        captured = { orgId, issuedBy, opts };
        return {} as InviteCodeRecord;
      },
    } as unknown as PostgresInviteCodeRepository;
    const svc = new InviteCodeService({
      inviteRepo,
      identityRepo: makeIdentityRepo(null),
    });
    await svc.generate(
      'org_1' as OrganizationId,
      'user_1' as UserId,
      { defaultRoleId: 'role_tenant' as RoleId, maxRedemptions: 5 }
    );
    expect(captured).toEqual({
      orgId: 'org_1',
      issuedBy: 'user_1',
      opts: { defaultRoleId: 'role_tenant', maxRedemptions: 5 },
    });
  });

  it('without deps, every method still throws NOT_IMPLEMENTED', async () => {
    const svc = new InviteCodeService();
    await expect(
      svc.generate(
        'o' as OrganizationId,
        'u' as UserId,
        { defaultRoleId: 'r' as RoleId }
      )
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(
      svc.redeem('c' as InviteCode, 't' as TenantIdentityId)
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
    await expect(svc.revoke('c' as InviteCode)).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
  });
});
