import { describe, it, expect } from 'vitest';
import { createChromaprintFingerprint } from '../chromaprint.js';
import { matchFingerprint, detectTampering } from '../matcher.js';
import { defaultAdapter } from '../adapters.js';
import type { AudioSample } from '../../types.js';

function makeAudio(bytes: number[]): AudioSample {
  return {
    bytes: Uint8Array.from(bytes),
    format: 'pcm',
    sampleRate: 16000,
    channels: 1,
    durationMs: Math.round((bytes.length / (16000 * 2)) * 1000),
  };
}

const sampleA = makeAudio(Array.from({ length: 3200 }, (_, i) => (i * 7) % 256));
const sampleB = makeAudio(Array.from({ length: 3200 }, (_, i) => (i * 7) % 256));
const sampleDifferent = makeAudio(Array.from({ length: 3200 }, (_, i) => (i * 13 + 5) % 256));
const sampleTampered = makeAudio(
  Array.from({ length: 3200 }, (_, i) => {
    // Flip a chunk of contiguous samples so the chroma frame changes.
    if (i >= 1600 && i < 1700) return 200;
    return (i * 7) % 256;
  }),
);

describe('createChromaprintFingerprint', () => {
  it('produces the same hash for identical audio bytes', () => {
    const fpA = createChromaprintFingerprint(sampleA, { nowIso: '2026-05-25T00:00:00.000Z' });
    const fpB = createChromaprintFingerprint(sampleB, { nowIso: '2026-05-25T00:00:00.000Z' });
    expect(fpA.hash).toEqual(fpB.hash);
    expect(fpA.compactSignature).toEqual(fpB.compactSignature);
  });

  it('produces different hashes for different audio bytes', () => {
    const fpA = createChromaprintFingerprint(sampleA);
    const fpC = createChromaprintFingerprint(sampleDifferent);
    expect(fpA.hash).not.toEqual(fpC.hash);
  });

  it('records the sample rate and duration', () => {
    const fp = createChromaprintFingerprint(sampleA);
    expect(fp.sampleRate).toBe(16000);
    expect(fp.durationMs).toBeGreaterThan(0);
    expect(fp.algorithm).toBe('chromaprint-stub');
  });

  it('throws on empty audio', () => {
    expect(() =>
      createChromaprintFingerprint({
        bytes: new Uint8Array(),
        format: 'pcm',
        sampleRate: 16000,
        channels: 1,
      }),
    ).toThrow(/empty/);
  });
});

describe('matchFingerprint', () => {
  it('returns matched=true with confidence 1 for identical fingerprints', () => {
    const fp = createChromaprintFingerprint(sampleA);
    const result = matchFingerprint(fp, fp);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(1);
    expect(result.hammingDistance).toBe(0);
  });

  it('returns matched=true for two fingerprints of the same audio', () => {
    const a = createChromaprintFingerprint(sampleA);
    const b = createChromaprintFingerprint(sampleB);
    const result = matchFingerprint(a, b);
    expect(result.matched).toBe(true);
  });

  it('returns matched=false for clearly different audio', () => {
    const a = createChromaprintFingerprint(sampleA);
    const c = createChromaprintFingerprint(sampleDifferent);
    const result = matchFingerprint(a, c, { threshold: 0.95 });
    expect(result.matched).toBe(false);
    expect(result.confidence).toBeLessThan(0.95);
  });

  it('honors a custom threshold', () => {
    const a = createChromaprintFingerprint(sampleA);
    const c = createChromaprintFingerprint(sampleDifferent);
    const lenient = matchFingerprint(a, c, { threshold: 0.0 });
    expect(lenient.matched).toBe(true);
  });

  it('throws on out-of-range threshold', () => {
    const fp = createChromaprintFingerprint(sampleA);
    expect(() => matchFingerprint(fp, fp, { threshold: 1.5 })).toThrow(/threshold/);
    expect(() => matchFingerprint(fp, fp, { threshold: -0.1 })).toThrow(/threshold/);
  });
});

describe('detectTampering', () => {
  it('returns false for an untampered fingerprint', () => {
    const fp = createChromaprintFingerprint(sampleA);
    expect(detectTampering(fp)).toBe(false);
  });

  it('returns true when the hash has been modified', () => {
    const fp = createChromaprintFingerprint(sampleA);
    const tampered = { ...fp, hash: 'deadbeef' };
    expect(detectTampering(tampered)).toBe(true);
  });

  it('detects byte-level audio differences when re-fingerprinted', () => {
    const original = createChromaprintFingerprint(sampleA);
    const modified = createChromaprintFingerprint(sampleTampered);
    expect(original.hash).not.toEqual(modified.hash);
  });
});

describe('defaultAdapter', () => {
  it('exposes a chromaprint adapter that returns deterministic fingerprints', async () => {
    const adapter = defaultAdapter();
    expect(adapter.name).toBe('chromaprint');
    const fp = await adapter.fingerprint(sampleA);
    expect(fp.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
