import { describe, it, expect } from 'vitest';
import {
  classifyAdversarialVoice,
  detectDeepfakeLiveness,
} from '../adversarial-classifier.js';
import { generateChallengePhrase, scoreChallengeResponse } from '../challenge-phrase.js';
import { buildDisclosureHeader, normaliseDisclosureLocale, getDisclosureBadge } from '../ai-voice-disclosure.js';
import {
  embedWatermark,
  verifyWatermark,
  derivePayloadSha256,
  getWatermarkProvider,
  type WatermarkPayload,
} from '../audioseal-watermark.js';
import { decideTtsProvider, reduceRecentTtfbP95 } from '../tts-failover.js';
import type { AcousticAdversarialFeatures } from '../types.js';

// ----------------------------------------------------------------------------
// Adversarial classifier
// ----------------------------------------------------------------------------

const natural: AcousticAdversarialFeatures = {
  bandEnergy: { lo: 0.5, mid: 0.3, hi: 0.2 },
  jitterPct: 1.2,
  shimmerPct: 2.0,
  doubleReverbScore: 0.05,
  voiceprintDelta: 0.1,
};

describe('classifyAdversarialVoice', () => {
  it('accepts a natural voice', () => {
    const v = classifyAdversarialVoice(natural);
    expect(v.label).toBe('natural');
    expect(v.recommended).toBe('accept');
  });

  it('flags synthesis from an underfilled hi band + low micro-prosody', () => {
    const v = classifyAdversarialVoice({
      ...natural,
      bandEnergy: { lo: 0.7, mid: 0.29, hi: 0.01 },
      jitterPct: 0.05,
      shimmerPct: 0.05,
    });
    expect(['likely_synthesised', 'uncertain']).toContain(v.label);
    expect(v.score).toBeGreaterThan(0);
    expect(v.contributors.length).toBeGreaterThan(0);
  });

  it('flags replay from a double-reverb signature', () => {
    const v = classifyAdversarialVoice({ ...natural, doubleReverbScore: 0.8 });
    expect(v.label).toBe('likely_replay');
    expect(v.recommended).toBe('escalate');
  });

  it('flags impersonation from a large voiceprint delta', () => {
    const v = classifyAdversarialVoice({ ...natural, voiceprintDelta: 0.95 });
    expect(v.label).toBe('likely_impersonation');
  });
});

describe('detectDeepfakeLiveness', () => {
  it('escalates when the challenge phrase does not match, even on clean audio', () => {
    const challenge = generateChallengePhrase({ locale: 'en', rng: () => 0 });
    const verdict = detectDeepfakeLiveness({
      features: natural,
      challenge,
      transcript: 'completely unrelated words',
    });
    expect(verdict.challengeMatched).toBe(false);
    expect(verdict.recommended).toBe('escalate');
  });

  it('accepts clean audio with a matching challenge', () => {
    const challenge = generateChallengePhrase({ locale: 'en', rng: () => 0 });
    const verdict = detectDeepfakeLiveness({
      features: natural,
      challenge,
      transcript: challenge.text,
    });
    expect(verdict.challengeMatched).toBe(true);
    expect(verdict.recommended).toBe('accept');
  });
});

// ----------------------------------------------------------------------------
// Challenge phrase
// ----------------------------------------------------------------------------

describe('challenge phrase', () => {
  it('is deterministic given an RNG and exposes tokens + nonce', () => {
    const p = generateChallengePhrase({ locale: 'en', rng: () => 1 });
    expect(p.nonce).toBe('1111');
    expect(p.tokens).toContain('1111');
    expect(p.text).toContain('Please say:');
  });

  it('matches a nonce spoken as separated digits', () => {
    const p = generateChallengePhrase({ locale: 'en', rng: () => 0, now: () => 1000 });
    // tokens: ['blue', 'river', '0000']; speak the nonce as four words.
    const r = scoreChallengeResponse(p, 'blue river 0 0 0 0', 1500);
    expect(r.matched).toBe(true);
  });

  it('scores a perfect read as matched', () => {
    const p = generateChallengePhrase({ locale: 'en', rng: () => 0, now: () => 1000 });
    const r = scoreChallengeResponse(p, p.text, 1500);
    expect(r.matched).toBe(true);
    expect(r.coverage).toBe(1);
  });

  it('rejects an expired challenge', () => {
    const p = generateChallengePhrase({ locale: 'en', rng: () => 0, now: () => 0 });
    const r = scoreChallengeResponse(p, p.text, 200_000);
    expect(r.matched).toBe(false);
  });

  it('builds a Swahili-only phrase for sw locale', () => {
    const p = generateChallengePhrase({ locale: 'sw', rng: () => 0 });
    expect(p.text).toContain('Tafadhali sema:');
  });
});

// ----------------------------------------------------------------------------
// AI-voice disclosure
// ----------------------------------------------------------------------------

describe('AI-voice disclosure', () => {
  it('builds an English header with a sha256 anchor', () => {
    const h = buildDisclosureHeader('en');
    expect(h.text).toContain('AI voice');
    expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.badge).toBe('AI voice');
  });

  it('builds a Swahili header (single-language) for sw-TZ', () => {
    const h = buildDisclosureHeader('sw-TZ');
    expect(h.locale).toBe('sw-TZ');
    expect(h.text).toContain('sauti ya AI');
    expect(h.text).not.toMatch(/AI voice notice/);
  });

  it('falls back to English for an unknown locale', () => {
    expect(normaliseDisclosureLocale('fr')).toBe('en');
    expect(getDisclosureBadge('zz')).toBe('AI voice');
  });

  it('uses no em dashes in customer-facing copy', () => {
    expect(buildDisclosureHeader('en').text).not.toContain('—');
    expect(buildDisclosureHeader('sw').text).not.toContain('—');
  });
});

// ----------------------------------------------------------------------------
// AudioSeal watermark
// ----------------------------------------------------------------------------

describe('AudioSeal watermark', () => {
  const payload: WatermarkPayload = {
    sessionId: 'sess-1',
    locale: 'en',
    synthesizedAt: '2026-06-03T10:00:00.000Z',
    audioHeaderSha256: 'a'.repeat(64),
  };

  // One full 36-byte signature needs ~35,848 samples at the 1024-frame
  // stride; use ~2 copies' worth so detection has redundancy.
  const SAMPLES = 80_000;

  function silence(samples: number): Int16Array {
    return new Int16Array(samples); // zeros
  }

  it('embeds without mutating the input and verifies', () => {
    const input = silence(SAMPLES);
    const out = embedWatermark(input, payload);
    expect(out).not.toBe(input);
    // Input untouched (immutability).
    expect(Array.from(input).every((s) => s === 0)).toBe(true);

    const result = verifyWatermark(out);
    expect(result.verified).toBe(true);
    expect(result.recoveredSha256).toBe(derivePayloadSha256(payload).toString('hex'));
    expect(result.copiesFound).toBeGreaterThan(0);
  });

  it('throws when the buffer is too small to hold a signature', () => {
    expect(() => embedWatermark(silence(100), payload)).toThrow();
  });

  it('detects tampering (a flipped LSB breaks the checksum)', () => {
    const out = embedWatermark(silence(SAMPLES), payload);
    // Flip the LSB of every frame's first sample so every recovered copy is
    // corrupted, guaranteeing no clean signature window survives.
    for (let i = 0; i < out.length; i += 1024) {
      out[i] = (out[i] ?? 0) ^ 1;
    }
    const result = verifyWatermark(out);
    if (result.verified) {
      expect(result.recoveredSha256).not.toBe(derivePayloadSha256(payload).toString('hex'));
    } else {
      expect(result.verified).toBe(false);
    }
  });

  it('reports the provider hook default', () => {
    expect(getWatermarkProvider()).toBe('lsb-fallback');
  });
});

// ----------------------------------------------------------------------------
// TTS failover decision
// ----------------------------------------------------------------------------

describe('decideTtsProvider', () => {
  it('respects an ops override to fallback', () => {
    const d = decideTtsProvider({ override: 'fallback', recentTtfbP95Ms: 10, fallbackConfigured: true });
    expect(d.provider).toBe('fallback');
    expect(d.reason).toBe('ops-override-fallback');
  });

  it('stays on primary on cold start (null measurement)', () => {
    const d = decideTtsProvider({ recentTtfbP95Ms: null, fallbackConfigured: true });
    expect(d.provider).toBe('primary');
    expect(d.reason).toBe('default-primary');
  });

  it('fails over on a P95 breach when a fallback exists', () => {
    const d = decideTtsProvider({ recentTtfbP95Ms: 400, thresholdMs: 250, fallbackConfigured: true });
    expect(d.provider).toBe('fallback');
    expect(d.reason).toBe('ttfb-breach');
  });

  it('does not fail over when no fallback is configured', () => {
    const d = decideTtsProvider({ recentTtfbP95Ms: 400, fallbackConfigured: false });
    expect(d.provider).toBe('primary');
  });

  it('reduceRecentTtfbP95 takes the max across slices', () => {
    expect(reduceRecentTtfbP95([{ ttfbP95Ms: 100 }, { ttfbP95Ms: 300 }, { ttfbP95Ms: null }])).toBe(300);
    expect(reduceRecentTtfbP95([{ ttfbP95Ms: null }])).toBeNull();
  });
});
