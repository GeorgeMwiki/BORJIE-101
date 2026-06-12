/**
 * IdentityRepository tests (in-memory twin) — the sub↔identity bridge (0345).
 *
 * Covers the resolution-order contract both implementations share:
 *   1. a mapped principal resolves to its identity (fast path, idempotent);
 *   2. a NEW principal with a phone matching an existing identity ATTACHES to
 *      that identity (one human, two subs — the phone-OTP + email-web case);
 *   3. email fallback matches when no phone is present;
 *   4. otherwise a fresh identity is created (phone- or email-keyed);
 *   5. phone-less AND email-less provisioning is refused (the 0345 CHECK
 *      tenant_identities_phone_or_email, asserted before the DB).
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemoryIdentityRepository,
  normalizePhoneDigits,
} from '../identity.repository.js';

describe('normalizePhoneDigits', () => {
  it('strips to digits and nulls empty input', () => {
    expect(normalizePhoneDigits('+255 712 345 678')).toBe('255712345678');
    expect(normalizePhoneDigits('255712345678')).toBe('255712345678');
    expect(normalizePhoneDigits('')).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
    expect(normalizePhoneDigits('+')).toBeNull();
  });
});

describe('IdentityRepository (in-memory twin)', () => {
  it('provision creates a phone-keyed identity and resolveByPrincipal finds it', async () => {
    const repo = createInMemoryIdentityRepository();
    const created = await repo.provision({
      supabaseUserId: 'sub-1',
      phoneE164: '+255712345678',
      displayName: 'Asha M',
    });
    expect(created.id).toMatch(/^tid_/);
    expect(created.phoneNormalized).toBe('255712345678');
    expect(created.displayName).toBe('Asha M');

    const resolved = await repo.resolveByPrincipal('sub-1');
    expect(resolved?.id).toBe(created.id);
  });

  it('provision is idempotent for a mapped principal', async () => {
    const repo = createInMemoryIdentityRepository();
    const a = await repo.provision({ supabaseUserId: 'sub-1', phoneE164: '+255700000001' });
    const b = await repo.provision({ supabaseUserId: 'sub-1', phoneE164: '+255700000001' });
    expect(b.id).toBe(a.id);
  });

  it('a SECOND principal with the same phone attaches to the SAME identity (one human, two subs)', async () => {
    const repo = createInMemoryIdentityRepository();
    const mobile = await repo.provision({
      supabaseUserId: 'sub-phone',
      phoneE164: '+255700000002',
    });
    const web = await repo.provision({
      supabaseUserId: 'sub-email',
      phoneE164: '+255700000002',
      email: 'asha@example.com',
    });
    expect(web.id).toBe(mobile.id);
    expect((await repo.resolveByPrincipal('sub-email'))?.id).toBe(mobile.id);
    expect((await repo.resolveByPrincipal('sub-phone'))?.id).toBe(mobile.id);
  });

  it('email fallback matches an email-keyed identity when no phone is present', async () => {
    const repo = createInMemoryIdentityRepository();
    const first = await repo.provision({
      supabaseUserId: 'sub-a',
      email: 'Owner@Example.com',
    });
    expect(first.phoneNormalized).toBeNull();
    const second = await repo.provision({
      supabaseUserId: 'sub-b',
      email: 'owner@example.com', // case-insensitive match
    });
    expect(second.id).toBe(first.id);
  });

  it('refuses provisioning with neither phone nor email (the 0345 CHECK)', async () => {
    const repo = createInMemoryIdentityRepository();
    await expect(
      repo.provision({ supabaseUserId: 'sub-x' }),
    ).rejects.toThrow(/phone\/email/);
  });

  it('resolveByPrincipal returns null for an unmapped sub', async () => {
    const repo = createInMemoryIdentityRepository();
    expect(await repo.resolveByPrincipal('sub-unknown')).toBeNull();
  });
});
