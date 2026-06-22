/**
 * R7 — real `LocalePurePort` (post-generation language guard) tests.
 *
 * Asserts the detector REPLACES the `() => true` no-op: it returns PURE for a
 * single-language reply under the active locale and MIXED for a code-switched
 * one — the exact signal a code-switching model trips.
 */

import { describe, it, expect } from 'vitest';
import {
  createLocalePurePort,
  isLocaleImpure,
  LOCALE_PURE_PAYLOAD_TEXT_KEY,
  LOCALE_PURE_PAYLOAD_LOCALE_KEY,
} from '../locale-pure.js';
import type { GatekeeperAction } from '../gatekeeper.js';

function action(text: string, locale: 'en' | 'sw'): GatekeeperAction {
  return {
    actionRef: 'reply-1',
    tenantScope: 'tnt_demo',
    payload: {
      [LOCALE_PURE_PAYLOAD_TEXT_KEY]: text,
      [LOCALE_PURE_PAYLOAD_LOCALE_KEY]: locale,
    },
  };
}

describe('isLocaleImpure', () => {
  it('passes a clean English reply under en', () => {
    expect(isLocaleImpure('Your royalty statement is ready to view.', 'en')).toBe(false);
  });

  it('passes a clean Swahili reply under sw', () => {
    expect(isLocaleImpure('Ripoti yako ya mrabaha iko tayari kwa kuangalia.', 'sw')).toBe(false);
  });

  it('flags a Swahili intrusion in an en reply (code-switch / mirror)', () => {
    expect(isLocaleImpure('Karibu tena, your statement is ready.', 'en')).toBe(true);
  });

  it('flags an English intrusion run in a sw reply', () => {
    expect(isLocaleImpure('Ripoti the report for the month.', 'sw')).toBe(true);
  });

  it('tolerates a single borrowed English token in a sw reply', () => {
    expect(isLocaleImpure('Ripoti yako iko tayari kama PDF.', 'sw')).toBe(false);
  });

  it('does not flag too-short / empty text', () => {
    expect(isLocaleImpure('', 'en')).toBe(false);
    expect(isLocaleImpure('ok', 'en')).toBe(false);
  });
});

describe('createLocalePurePort', () => {
  it('returns true (PURE) for a single-language reply', () => {
    const port = createLocalePurePort();
    expect(port(action('Your statement is ready.', 'en'))).toBe(true);
  });

  it('returns false (MIXED) for a code-switched reply — no longer a no-op', () => {
    const port = createLocalePurePort();
    expect(port(action('Habari! Welcome back, karibu tena.', 'en'))).toBe(false);
  });

  it('defaults to en when no locale is stamped', () => {
    const port = createLocalePurePort();
    expect(
      port({
        actionRef: 'r',
        tenantScope: 't',
        payload: { [LOCALE_PURE_PAYLOAD_TEXT_KEY]: 'Karibu, habari yako?' },
      }),
    ).toBe(false);
  });

  it('returns true when no reply text is present (nothing to certify)', () => {
    const port = createLocalePurePort();
    expect(port({ actionRef: 'r', tenantScope: 't' })).toBe(true);
    expect(port({ actionRef: 'r', tenantScope: 't', payload: {} })).toBe(true);
  });

  it('never throws on a malformed payload', () => {
    const port = createLocalePurePort();
    expect(() =>
      port({ actionRef: 'r', tenantScope: 't', payload: { replyText: 123 as unknown as string } }),
    ).not.toThrow();
  });
});
