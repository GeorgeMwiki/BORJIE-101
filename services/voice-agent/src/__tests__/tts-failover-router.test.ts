import { describe, it, expect } from 'vitest';
import { routeTtsWithFailover, type TtfbP95Source } from '../router/tts-failover-router.js';

function source(value: number | null, throws = false): TtfbP95Source {
  return {
    recentP95Ms: async () => {
      if (throws) throw new Error('rollup down');
      return value;
    },
  };
}

describe('routeTtsWithFailover', () => {
  it('keeps the language-policy provider when P95 is healthy', async () => {
    // English routes to Cartesia by policy already; use Swahili (ElevenLabs).
    const d = await routeTtsWithFailover('sw', source(80), { thresholdMs: 250 });
    expect(d.provider).toBe('elevenlabs-v3');
    expect(d.failoverReason).toBe('language-policy');
  });

  it('fails over to Cartesia on a P95 breach', async () => {
    const d = await routeTtsWithFailover('sw', source(400), { thresholdMs: 250 });
    expect(d.provider).toBe('cartesia-sonic-2');
    expect(d.failoverReason).toBe('ttfb-breach');
    expect(d.recentTtfbP95Ms).toBe(400);
  });

  it('does not re-failover when the policy provider is already Cartesia', async () => {
    const d = await routeTtsWithFailover('en', source(400), { thresholdMs: 250 });
    expect(d.provider).toBe('cartesia-sonic-2');
    expect(d.failoverReason).toBe('language-policy');
  });

  it('honours an ops override to cartesia', async () => {
    const d = await routeTtsWithFailover('sw', source(50), { override: 'cartesia' });
    expect(d.provider).toBe('cartesia-sonic-2');
    expect(d.failoverReason).toBe('ops-override');
  });

  it('honours an ops override to elevenlabs', async () => {
    const d = await routeTtsWithFailover('en', source(999), { override: 'elevenlabs' });
    expect(d.provider).toBe('elevenlabs-v3');
    expect(d.failoverReason).toBe('ops-override');
  });

  it('is fail-soft: a throwing rollup keeps the policy choice', async () => {
    const d = await routeTtsWithFailover('sw', source(null, true), { thresholdMs: 250 });
    expect(d.provider).toBe('elevenlabs-v3');
    expect(d.failoverReason).toBe('language-policy');
    expect(d.recentTtfbP95Ms).toBeNull();
  });

  it('stays on primary on cold start (null measurement)', async () => {
    const d = await routeTtsWithFailover('sw', source(null), { thresholdMs: 250 });
    expect(d.provider).toBe('elevenlabs-v3');
  });
});
