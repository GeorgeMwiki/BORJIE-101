import { describe, expect, it } from 'vitest';

import { routeStt } from '../router/stt-router.js';

describe('routeStt', () => {
  it('routes Swahili family to Lelapa', () => {
    expect(routeStt('sw').provider).toBe('lelapa-vulavula');
    expect(routeStt('sw-TZ').provider).toBe('lelapa-vulavula');
    expect(routeStt('sheng').provider).toBe('lelapa-vulavula');
  });

  it('routes Luganda variants to Lelapa', () => {
    expect(routeStt('lug').provider).toBe('lelapa-vulavula');
    expect(routeStt('lg').provider).toBe('lelapa-vulavula');
  });

  it('routes Nigerian languages to Spitch', () => {
    expect(routeStt('yo').provider).toBe('spitch');
    expect(routeStt('ig').provider).toBe('spitch');
    expect(routeStt('ha').provider).toBe('spitch');
  });

  it('routes English to gpt-realtime-2 duplex', () => {
    expect(routeStt('en').provider).toBe('gpt-realtime-2');
    expect(routeStt('en-KE').provider).toBe('gpt-realtime-2');
  });

  it('always includes a non-empty rationale', () => {
    for (const tag of ['en', 'en-KE', 'sw', 'sw-TZ', 'sheng', 'lug', 'lg', 'yo', 'ig', 'ha'] as const) {
      const decision = routeStt(tag);
      expect(decision.rationale.length).toBeGreaterThan(0);
    }
  });
});
