import { describe, expect, it } from 'vitest';
import { createInMemoryUserProfileRepository } from '../repositories/user-profile-repository.js';
import { createUserProfileManager } from '../profile/user-profile-manager.js';
import { LanguageSotaError } from '../types.js';

describe('user-profile manager + repository', () => {
  it('creates a profile with platform defaults on first call', async () => {
    const repo = createInMemoryUserProfileRepository();
    const mgr = createUserProfileManager({ repository: repo });
    const p = await mgr.ensureProfile({
      tenantId: 'A',
      userId: 'user-1',
    });
    expect(p.preferredLang).toBe('en');
    expect(p.secondaryLang).toBe('sw');
    expect(p.dialectTags).toEqual([]);
  });

  it('respects explicit lang preference on creation', async () => {
    const repo = createInMemoryUserProfileRepository();
    const mgr = createUserProfileManager({ repository: repo });
    const p = await mgr.ensureProfile({
      tenantId: 'A',
      userId: 'mwiki',
      preferredLang: 'sw',
      secondaryLang: 'en',
    });
    expect(p.preferredLang).toBe('sw');
    expect(p.secondaryLang).toBe('en');
  });

  it('setPreferred mutates the row (returning a new immutable row)', async () => {
    const repo = createInMemoryUserProfileRepository();
    const mgr = createUserProfileManager({ repository: repo });
    await mgr.ensureProfile({ tenantId: 'A', userId: 'mwiki' });
    const updated = await mgr.setPreferred('A', 'mwiki', 'sw');
    expect(updated.preferredLang).toBe('sw');
    const fetched = await repo.findByKey('A', 'mwiki');
    expect(fetched?.preferredLang).toBe('sw');
  });

  it('addDialectTag appends without duplicates', async () => {
    const repo = createInMemoryUserProfileRepository();
    const mgr = createUserProfileManager({ repository: repo });
    await mgr.ensureProfile({ tenantId: 'A', userId: 'mwiki' });
    const r1 = await mgr.addDialectTag('A', 'mwiki', 'sw-TZ-coastal');
    expect(r1.dialectTags).toEqual(['sw-TZ-coastal']);
    const r2 = await mgr.addDialectTag('A', 'mwiki', 'sw-TZ-coastal');
    expect(r2.dialectTags).toEqual(['sw-TZ-coastal']);
    const r3 = await mgr.addDialectTag('A', 'mwiki', 'sheng-mwanza');
    expect(r3.dialectTags).toEqual(['sw-TZ-coastal', 'sheng-mwanza']);
  });

  it('rejects setPreferred for a missing profile', async () => {
    const repo = createInMemoryUserProfileRepository();
    const mgr = createUserProfileManager({ repository: repo });
    await expect(mgr.setPreferred('A', 'ghost', 'sw')).rejects.toBeInstanceOf(
      LanguageSotaError,
    );
  });

  it('updateBaseline folds GOP scores into the pronunciation profile', async () => {
    const repo = createInMemoryUserProfileRepository();
    const mgr = createUserProfileManager({ repository: repo });
    await mgr.ensureProfile({ tenantId: 'A', userId: 'mwiki' });
    const updated = await mgr.updateBaseline({
      tenantId: 'A',
      userId: 'mwiki',
      phonemes: [
        { ipa: 'm', startMs: 0, endMs: 50, gop: 0.8 },
        { ipa: 'i', startMs: 50, endMs: 100, gop: 0.75 },
        { ipa: 'm', startMs: 100, endMs: 150, gop: 0.85 },
      ],
    });
    expect(updated.pronunciationProfile['m']!.samples).toBe(2);
    expect(updated.pronunciationProfile['i']!.samples).toBe(1);
    expect(updated.pronunciationProfile['m']!.gopMean).toBeCloseTo(0.825, 5);
  });
});
