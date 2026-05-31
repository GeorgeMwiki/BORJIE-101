/**
 * translate() facade tests — passthrough, cache, fallback semantics.
 */

import { describe, expect, it, vi } from 'vitest';
import { createTranslate } from '../translate.js';
import { createInMemoryTranslationCache } from '../in-memory-cache.js';
import { resolveRecipientLocale, sourceLangFor } from '../recipient-locale.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeFakeRunner(targetText: string) {
  return {
    async run() {
      return {
        tenantId: 't1',
        runId: 'run-1',
        sourceLang: 'en' as const,
        targetLang: 'sw' as const,
        sourceText: '',
        targetText,
        provider: 'claude-opus-4-7' as const,
        register: { level: 'neutral' as const, honorific: undefined },
        glossaryTermsUsed: [],
        codeSwitchSegments: [],
        bleu: null,
        chrf: null,
        terminologyAdherence: 1,
        latencyMs: 12,
        costUsdCents: 1,
        auditHash: 'h',
        prevHash: 'p',
        createdAt: new Date(),
        demotions: [],
      };
    },
  };
}

describe('translate()', () => {
  it('passes through when source and target match', async () => {
    const cache = createInMemoryTranslationCache();
    const runner = makeFakeRunner('Karibu');
    const translate = createTranslate({
      cache,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner: runner as any,
      logger: makeLogger(),
    });

    const out = await translate({
      text: 'Welcome',
      sourceLang: 'en',
      targetLang: 'en',
      tenantId: 't1',
    });

    expect(out.text).toBe('Welcome');
    expect(out.provider).toBe('passthrough');
    expect(out.cacheHit).toBe(false);
    expect(cache.stats().size).toBe(0);
  });

  it('returns cache hit on second identical call', async () => {
    const cache = createInMemoryTranslationCache();
    const runner = makeFakeRunner('Karibu Borjie');
    const translate = createTranslate({
      cache,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner: runner as any,
      logger: makeLogger(),
    });

    const first = await translate({
      text: 'Welcome to Borjie',
      sourceLang: 'en',
      targetLang: 'sw',
      tenantId: 't1',
      surface: 'email.welcome.subject',
    });
    expect(first.cacheHit).toBe(false);
    expect(first.text).toBe('Karibu Borjie');

    const second = await translate({
      text: 'Welcome to Borjie',
      sourceLang: 'en',
      targetLang: 'sw',
      tenantId: 't1',
      surface: 'email.welcome.subject',
    });
    expect(second.cacheHit).toBe(true);
    expect(second.text).toBe('Karibu Borjie');
    expect(second.provider).toBe('cache');
  });

  it('fails open with source text when runner throws', async () => {
    const cache = createInMemoryTranslationCache();
    const broken = {
      async run() {
        throw new Error('all providers exhausted');
      },
    };
    const logger = makeLogger();
    const translate = createTranslate({
      cache,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner: broken as any,
      logger,
    });

    const out = await translate({
      text: 'Welcome to Borjie',
      sourceLang: 'en',
      targetLang: 'sw',
      tenantId: 't1',
      surface: 'email.welcome.subject',
    });
    expect(out.text).toBe('Welcome to Borjie');
    expect(out.provider).toBe('passthrough');
    expect(logger.error).toHaveBeenCalled();
  });

  it('throws when strict=true and runner fails', async () => {
    const cache = createInMemoryTranslationCache();
    const broken = {
      async run() {
        throw new Error('all providers exhausted');
      },
    };
    const translate = createTranslate({
      cache,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner: broken as any,
      logger: makeLogger(),
    });

    await expect(
      translate(
        {
          text: 'Welcome',
          sourceLang: 'en',
          targetLang: 'sw',
          tenantId: 't1',
          surface: 'email.subject',
        },
        { strict: true },
      ),
    ).rejects.toThrow('all providers exhausted');
  });
});

describe('resolveRecipientLocale', () => {
  it('prefers profile language', () => {
    expect(
      resolveRecipientLocale({
        profilePreferredLanguage: 'sw',
        tenantDefaultLanguage: 'en',
      }),
    ).toBe('sw');
  });

  it('falls back to tenant default', () => {
    expect(
      resolveRecipientLocale({
        profilePreferredLanguage: null,
        tenantDefaultLanguage: 'sw',
      }),
    ).toBe('sw');
  });

  it('falls back to en when neither is supported', () => {
    expect(
      resolveRecipientLocale({
        profilePreferredLanguage: 'fr',
        tenantDefaultLanguage: 'de',
      }),
    ).toBe('en');
  });
});

describe('sourceLangFor', () => {
  it('returns the opposite of target', () => {
    expect(sourceLangFor('sw')).toBe('en');
    expect(sourceLangFor('en')).toBe('sw');
  });
});
