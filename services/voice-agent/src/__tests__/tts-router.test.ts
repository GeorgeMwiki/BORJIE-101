import { describe, expect, it } from 'vitest';

import { routeTts } from '../router/tts-router.js';

describe('routeTts (best-quality, default tier)', () => {
  it('routes Swahili family to ElevenLabs v3', () => {
    expect(routeTts('sw').provider).toBe('elevenlabs-v3');
    expect(routeTts('sw-TZ').provider).toBe('elevenlabs-v3');
    expect(routeTts('sheng').provider).toBe('elevenlabs-v3');
  });

  it('routes Luganda variants to ElevenLabs v3', () => {
    expect(routeTts('lug').provider).toBe('elevenlabs-v3');
    expect(routeTts('lg').provider).toBe('elevenlabs-v3');
  });

  it('routes Nigerian languages to ElevenLabs v3 (not Spitch)', () => {
    expect(routeTts('yo').provider).toBe('elevenlabs-v3');
    expect(routeTts('ig').provider).toBe('elevenlabs-v3');
    expect(routeTts('ha').provider).toBe('elevenlabs-v3');
  });

  it('routes English to Cartesia Sonic-2 for low TTFB', () => {
    expect(routeTts('en').provider).toBe('cartesia-sonic-2');
    expect(routeTts('en-KE').provider).toBe('cartesia-sonic-2');
  });
});

describe('routeTts (low-latency override)', () => {
  it('forces Cartesia regardless of language when tier is low-latency', () => {
    expect(routeTts('sw', 'low-latency').provider).toBe('cartesia-sonic-2');
    expect(routeTts('yo', 'low-latency').provider).toBe('cartesia-sonic-2');
    expect(routeTts('en', 'low-latency').provider).toBe('cartesia-sonic-2');
  });

  it('does not affect routing when tier is best-quality', () => {
    expect(routeTts('sw', 'best-quality').provider).toBe('elevenlabs-v3');
    expect(routeTts('en', 'best-quality').provider).toBe('cartesia-sonic-2');
  });
});

describe('routeTts rationale', () => {
  it('always includes a non-empty rationale', () => {
    for (const tag of ['en', 'en-KE', 'sw', 'sw-TZ', 'sheng', 'lug', 'lg', 'yo', 'ig', 'ha'] as const) {
      expect(routeTts(tag).rationale.length).toBeGreaterThan(0);
      expect(routeTts(tag, 'low-latency').rationale.length).toBeGreaterThan(0);
    }
  });
});
