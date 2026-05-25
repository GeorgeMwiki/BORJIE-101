import { describe, expect, it } from 'vitest';
import { createMockEnhancement } from '../../src/enhancement/mock.js';
import type { AudioChunk } from '../../src/types.js';

const makeChunk = (amp: number): AudioChunk => {
  const samples = new Int16Array(2048);
  for (let i = 0; i < samples.length; i += 1) samples[i] = amp;
  return {
    bytes: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    format: 'pcm',
    sampleRate: 16000,
    channels: 1,
  };
};

describe('createMockEnhancement', () => {
  it('denoise zero-crosses sub-floor samples', async () => {
    const enhancer = createMockEnhancement();
    const denoised = await enhancer.enhance({
      audio: makeChunk(500),
      target: 'denoise',
    });
    expect(Array.from(denoised.bytes).every((b) => b === 0)).toBe(true);
  });

  it('normalize boosts a quiet signal', async () => {
    const enhancer = createMockEnhancement();
    const normalized = await enhancer.enhance({
      audio: makeChunk(1000),
      target: 'normalize',
    });
    // Boosted bytes should differ from the input.
    expect(Array.from(normalized.bytes).slice(0, 16)).not.toEqual(
      Array.from(makeChunk(1000).bytes).slice(0, 16),
    );
  });

  it('all chains denoise + dereverb + normalize without throwing', async () => {
    const enhancer = createMockEnhancement();
    const out = await enhancer.enhance({
      audio: makeChunk(8000),
      target: 'all',
    });
    expect(out.bytes.byteLength).toBe(2048 * 2);
  });
});
