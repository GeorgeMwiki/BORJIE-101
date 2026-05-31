import { describe, expect, it } from 'vitest';
import { contentHash, canonicalCacheString } from '../hash.js';
import type { TranslationCacheKey } from '../types.js';

function key(overrides: Partial<TranslationCacheKey> = {}): TranslationCacheKey {
  return {
    tenantId: 't1',
    sourceText: 'Welcome to Borjie',
    sourceLang: 'en',
    targetLang: 'sw',
    register: 'neutral',
    surface: 'email.welcome.subject',
    ...overrides,
  };
}

describe('contentHash', () => {
  it('produces a 64-char hex digest', () => {
    const h = contentHash(key());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls with identical content', () => {
    expect(contentHash(key())).toBe(contentHash(key()));
  });

  it('ignores tenantId — same content across tenants collapses', () => {
    const a = contentHash(key({ tenantId: 't1' }));
    const b = contentHash(key({ tenantId: 't2' }));
    expect(a).toBe(b);
  });

  it('changes when source text changes', () => {
    const a = contentHash(key({ sourceText: 'Hello' }));
    const b = contentHash(key({ sourceText: 'Bye' }));
    expect(a).not.toBe(b);
  });

  it('changes when target language changes', () => {
    const a = contentHash(key({ targetLang: 'sw' }));
    const b = contentHash(key({ targetLang: 'en' }));
    expect(a).not.toBe(b);
  });

  it('changes when surface changes', () => {
    const a = contentHash(key({ surface: 'email.welcome.subject' }));
    const b = contentHash(key({ surface: 'email.welcome.body' }));
    expect(a).not.toBe(b);
  });
});

describe('canonicalCacheString', () => {
  it('joins fields in stable order', () => {
    const s = canonicalCacheString(key());
    expect(s).toContain('en');
    expect(s).toContain('sw');
    expect(s).toContain('neutral');
    expect(s).toContain('email.welcome.subject');
    expect(s).toContain('Welcome to Borjie');
  });
});
