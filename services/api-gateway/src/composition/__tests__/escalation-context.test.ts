import { afterEach, describe, expect, it } from 'vitest';
import {
  setGlobalTranslate,
  resetGlobalTranslateForTests,
} from '@borjie/translation';

import {
  resolveEscalationContextEn,
  withContextEn,
} from '../escalation-context.js';

const TENANT = 'tnt_test_escalation';

function stubTranslate(
  text: string,
  provider: 'cache' | 'claude-opus-4-8' = 'claude-opus-4-8',
): void {
  setGlobalTranslate(async (input) => ({
    text,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    cacheHit: provider === 'cache',
    provider,
    latencyMs: 1,
  }));
}

afterEach(() => {
  resetGlobalTranslateForTests();
});

describe('resolveEscalationContextEn', () => {
  it('returns the English narrative when the provider succeeds', async () => {
    stubTranslate('Drill rig down at Site 4, urgent.');
    const en = await resolveEscalationContextEn(
      'Mtambo umezimika Site 4, dharura.',
      TENANT,
    );
    expect(en).toBe('Drill rig down at Site 4, urgent.');
  });

  it('accepts a cache-provider result as a real translation', async () => {
    stubTranslate('Cached English body.', 'cache');
    expect(
      await resolveEscalationContextEn('Mwili wa Kiswahili.', TENANT),
    ).toBe('Cached English body.');
  });

  it('returns null when translation is unbound (passthrough), never the Swahili source', async () => {
    // translate() fail-opens to provider:passthrough when unbound — we must
    // NOT pass the Swahili through as the English narrative (zero-mix).
    expect(
      await resolveEscalationContextEn('Mwili wa Kiswahili.', TENANT),
    ).toBeNull();
  });

  it('returns null for an empty narrative without calling the provider', async () => {
    let called = false;
    setGlobalTranslate(async (input) => {
      called = true;
      return {
        text: input.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        cacheHit: false,
        provider: 'claude-opus-4-8',
        latencyMs: 0,
      };
    });
    expect(await resolveEscalationContextEn('   ', TENANT)).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null when the provider throws (an escalation must still raise)', async () => {
    setGlobalTranslate(async () => {
      throw new Error('provider down');
    });
    expect(await resolveEscalationContextEn('Mwili.', TENANT)).toBeNull();
  });

  it('returns null on a no-op translation (output identical to source)', async () => {
    stubTranslate('Mwili wa Kiswahili.');
    expect(
      await resolveEscalationContextEn('Mwili wa Kiswahili.', TENANT),
    ).toBeNull();
  });
});

describe('withContextEn — the persisted context bag carries contextEn', () => {
  it('merges a string contextEn into the bag, preserving the other fields', () => {
    const bag = withContextEn({ orgPath: true, title: 'X' }, 'English body');
    expect(bag.contextEn).toBe('English body');
    expect(bag.orgPath).toBe(true);
    expect(bag.title).toBe('X');
  });

  it('includes contextEn=null explicitly so the GET reader key is present', () => {
    const bag = withContextEn({ a: 1 }, null);
    expect('contextEn' in bag).toBe(true);
    expect(bag.contextEn).toBeNull();
  });

  it('does not mutate the source bag (immutability)', () => {
    const src = { a: 1 };
    const out = withContextEn(src, 'en');
    expect(out).not.toBe(src);
    expect('contextEn' in src).toBe(false);
  });
});
