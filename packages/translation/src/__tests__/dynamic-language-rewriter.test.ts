/**
 * dynamic-language-rewriter tests (LP-23).
 *
 * Covers the four required cases:
 *   1. clean passthrough (no AI call),
 *   2. contaminated -> live AI rewrite,
 *   3. rewrite failure -> safe single-language fallback (never mixed),
 *   4. cache hit on a repeated identical leak.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createDynamicLanguageRewriter,
  createInMemoryRewriteCache,
  buildRewriterSystemPrompt,
  BORJIE_PRESERVE_TOKENS,
  type LanguageRewriterPort,
} from '../dynamic-language-rewriter.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

function portReturning(output: string): LanguageRewriterPort {
  return { rewrite: vi.fn(async () => output) };
}

describe('createDynamicLanguageRewriter', () => {
  it('passes clean target-language text through without an AI call', async () => {
    const port = portReturning('SHOULD NOT BE USED');
    const rewrite = createDynamicLanguageRewriter({ port, logger: makeLogger() });

    const out = await rewrite({
      text: 'Karibu kwenye mgodi wako. Hapa ndipo unapoanza.',
      targetLang: 'sw',
      safeFallback: 'Karibu.',
    });

    expect(out.source).toBe('skip');
    expect(out.rewritten).toBe(false);
    expect(out.text).toBe('Karibu kwenye mgodi wako. Hapa ndipo unapoanza.');
    expect(port.rewrite).not.toHaveBeenCalled();
  });

  it('fires a live AI rewrite when the text is contaminated', async () => {
    // Swahili target leaking English function words ("the", "and", "with").
    const contaminated = 'Karibu the mgodi and wako with leseni mpya kwenye Borjie.';
    const port = portReturning('Karibu kwenye mgodi wako wenye leseni mpya kwenye Borjie.');
    const logger = makeLogger();
    const rewrite = createDynamicLanguageRewriter({ port, logger });

    const out = await rewrite({
      text: contaminated,
      targetLang: 'sw',
      safeFallback: 'Karibu.',
    });

    expect(out.source).toBe('brain');
    expect(out.rewritten).toBe(true);
    expect(out.offTargetRatio).toBeGreaterThan(0);
    expect(out.text).toBe('Karibu kwenye mgodi wako wenye leseni mpya kwenye Borjie.');
    expect(port.rewrite).toHaveBeenCalledTimes(1);
  });

  it('passes the built system prompt + preserve tokens to the port', async () => {
    const contaminated = 'Habari, the licence and royalty ziko tayari kwa Borjie.';
    const port: LanguageRewriterPort = { rewrite: vi.fn(async () => 'Habari, leseni na mrabaha ziko tayari kwa Borjie.') };
    const rewrite = createDynamicLanguageRewriter({ port, logger: makeLogger() });

    await rewrite({ text: contaminated, targetLang: 'sw', safeFallback: 'Habari.' });

    const arg = (port.rewrite as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.targetLang).toBe('sw');
    expect(arg.systemPrompt).toContain('Swahili');
    expect(arg.preserve).toContain('Mr. Mwikila');
    expect(arg.preserve).toContain('Borjie');
  });

  it('falls back to the SAFE single-language string when the rewrite throws', async () => {
    // English target leaking Swahili function words (na, kwa, ya, ni).
    const contaminated = 'Your licence na royalty kwa Borjie ya mwaka ni ready.';
    const port: LanguageRewriterPort = {
      rewrite: vi.fn(async () => {
        throw new Error('all providers exhausted');
      }),
    };
    const logger = makeLogger();
    const rewrite = createDynamicLanguageRewriter({ port, logger });

    const out = await rewrite({
      text: contaminated,
      targetLang: 'en',
      safeFallback: 'Your licence is ready.',
    });

    expect(out.source).toBe('safe-fallback');
    expect(out.rewritten).toBe(false);
    expect(out.text).toBe('Your licence is ready.');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('refuses to ship a still-contaminated rewrite and uses the safe fallback', async () => {
    const contaminated = 'Habari the mradi and wako kwa Borjie leo hii.';
    // Model "rewrote" but STILL leaked English function words.
    const port = portReturning('Habari the project and yours with Borjie leo hii today.');
    const rewrite = createDynamicLanguageRewriter({ port, logger: makeLogger() });

    const out = await rewrite({
      text: contaminated,
      targetLang: 'sw',
      safeFallback: 'Habari, taarifa zako ziko tayari.',
    });

    expect(out.source).toBe('safe-fallback');
    expect(out.text).toBe('Habari, taarifa zako ziko tayari.');
  });

  it('returns an empty string rather than a mixed one when the fallback also leaks', async () => {
    // English target leaking Swahili function words (na, kwa, ya).
    const contaminated = 'Your licence na royalty kwa Borjie ya mwaka iko ready.';
    const port: LanguageRewriterPort = {
      rewrite: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const rewrite = createDynamicLanguageRewriter({ port, logger: makeLogger() });

    const out = await rewrite({
      text: contaminated,
      targetLang: 'en',
      // Fallback is itself contaminated (Swahili words in an English string).
      safeFallback: 'Your leseni na mrabaha kwa mgodi wako kwenye Borjie.',
    });

    // A blank is never a zero-mix violation; a mixed string is.
    expect(out.text).toBe('');
    expect(out.source).toBe('safe-fallback');
  });

  it('serves a cache hit on a repeated identical leak (one AI call only)', async () => {
    const contaminated = 'Karibu the mgodi and wako with leseni mpya kwenye Borjie.';
    const port = portReturning('Karibu kwenye mgodi wako wenye leseni mpya kwenye Borjie.');
    const cache = createInMemoryRewriteCache();
    const rewrite = createDynamicLanguageRewriter({ port, logger: makeLogger(), cache });

    const first = await rewrite({ text: contaminated, targetLang: 'sw', safeFallback: 'Karibu.' });
    const second = await rewrite({ text: contaminated, targetLang: 'sw', safeFallback: 'Karibu.' });

    expect(first.source).toBe('brain');
    expect(second.source).toBe('cache');
    expect(second.text).toBe(first.text);
    expect(port.rewrite).toHaveBeenCalledTimes(1);
  });

  it('skips empty / whitespace-only input', async () => {
    const port = portReturning('x');
    const rewrite = createDynamicLanguageRewriter({ port, logger: makeLogger() });

    const out = await rewrite({ text: '   ', targetLang: 'sw', safeFallback: 'Karibu.' });

    expect(out.source).toBe('skip');
    expect(port.rewrite).not.toHaveBeenCalled();
  });
});

describe('buildRewriterSystemPrompt', () => {
  it('names the target language and lists preserve tokens', () => {
    const prompt = buildRewriterSystemPrompt('en', BORJIE_PRESERVE_TOKENS);
    expect(prompt).toContain('English');
    expect(prompt).toContain('Swahili');
    expect(prompt).toContain('Borjie');
    expect(prompt).toContain('Output ONLY the rewritten text');
  });
});

describe('createInMemoryRewriteCache', () => {
  it('evicts the oldest entry past capacity', () => {
    const cache = createInMemoryRewriteCache(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3'); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });
});
