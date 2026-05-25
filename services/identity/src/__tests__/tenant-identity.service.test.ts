/**
 * Stub sanity tests for TenantIdentityService.
 *
 * Until the real implementation lands these tests only assert that:
 *   (a) every expected method is defined on the class prototype;
 *   (b) each method rejects with NOT_IMPLEMENTED;
 *   (c) method arity matches the documented signature.
 *
 * When the real impl lands these assertions will be replaced with
 * behavior tests — these stub tests will fail loudly, which is the signal
 * to rewrite them.
 */

import { describe, expect, it } from 'vitest';
import { TenantIdentityService } from '../tenant-identity.service.js';
import type { TenantIdentityId } from '@borjie/domain-models';

describe('TenantIdentityService (stub)', () => {
  const svc = new TenantIdentityService();

  it('defines every required method on the prototype', () => {
    const methods: ReadonlyArray<keyof TenantIdentityService> = [
      'createOrUpsertByPhone',
      'verifyPhoneOTP',
      'getMemberships',
      'mergeDuplicates',
    ];
    for (const m of methods) {
      expect(typeof svc[m]).toBe('function');
    }
  });

  it('createOrUpsertByPhone accepts (phone, countryCode) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.createOrUpsertByPhone.length).toBe(2);
    await expect(svc.createOrUpsertByPhone('+255712345678', 'TZ')).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
  });

  it('verifyPhoneOTP accepts (identityId, code) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.verifyPhoneOTP.length).toBe(2);
    await expect(
      svc.verifyPhoneOTP('id-1' as TenantIdentityId, '123456')
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });

  it('getMemberships accepts (identityId) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.getMemberships.length).toBe(1);
    await expect(svc.getMemberships('id-1' as TenantIdentityId)).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
  });

  it('mergeDuplicates accepts (primaryId, duplicateId) and rejects NOT_IMPLEMENTED', async () => {
    expect(svc.mergeDuplicates.length).toBe(2);
    await expect(
      svc.mergeDuplicates(
        'id-1' as TenantIdentityId,
        'id-2' as TenantIdentityId
      )
    ).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
