import { describe, expect, it } from 'vitest';
import {
  isPublicRoute,
  resolveLocalePrefix,
  LOCALE_HEADER,
} from '../middleware';

/**
 * SEO-L3 guards for the /sw locale-prefix middleware:
 *  - a `/sw/<public>` path resolves to the stripped route + sw locale so a
 *    cookieless crawler is served Swahili;
 *  - a `/sw/<unknown>` path resolves to null (falls through to 404) — the
 *    rewrite never leaks into a non-public surface;
 *  - a non-/sw path is untouched.
 */

describe('resolveLocalePrefix (SEO-L3 swahili URLs)', () => {
  it('maps bare /sw and /sw/ to the home route in swahili', () => {
    expect(resolveLocalePrefix('/sw')).toEqual({
      locale: 'sw',
      strippedPath: '/',
    });
    expect(resolveLocalePrefix('/sw/')).toEqual({
      locale: 'sw',
      strippedPath: '/',
    });
  });

  it('strips /sw from a public segment route and keeps the leading slash', () => {
    expect(resolveLocalePrefix('/sw/for-pml')).toEqual({
      locale: 'sw',
      strippedPath: '/for-pml',
    });
    expect(resolveLocalePrefix('/sw/pricing')).toEqual({
      locale: 'sw',
      strippedPath: '/pricing',
    });
    expect(resolveLocalePrefix('/sw/legal/terms')).toEqual({
      locale: 'sw',
      strippedPath: '/legal/terms',
    });
  });

  it('returns null for a /sw path that is not a public route (no leak)', () => {
    expect(resolveLocalePrefix('/sw/api/subscribe')).toBeNull();
    expect(resolveLocalePrefix('/sw/nonexistent')).toBeNull();
  });

  it('returns null for a non-/sw path (byte-identical passthrough)', () => {
    expect(resolveLocalePrefix('/for-pml')).toBeNull();
    expect(resolveLocalePrefix('/')).toBeNull();
    expect(resolveLocalePrefix('/swahili')).toBeNull();
  });
});

describe('isPublicRoute', () => {
  it('accepts the whole /for-* family by prefix (drift-safe)', () => {
    expect(isPublicRoute('/for-pml')).toBe(true);
    expect(isPublicRoute('/for-a-new-segment-added-later')).toBe(true);
  });

  it('accepts enumerated static + nested legal routes', () => {
    expect(isPublicRoute('/pricing')).toBe(true);
    expect(isPublicRoute('/legal/cookies')).toBe(true);
    expect(isPublicRoute('/blog/some-slug')).toBe(true);
  });

  it('rejects api and unknown routes', () => {
    expect(isPublicRoute('/api/subscribe')).toBe(false);
    expect(isPublicRoute('/nope')).toBe(false);
  });
});

describe('LOCALE_HEADER contract', () => {
  it('matches the header name lib/locale.ts reads before the cookie', () => {
    expect(LOCALE_HEADER).toBe('x-borjie-locale');
  });
});
