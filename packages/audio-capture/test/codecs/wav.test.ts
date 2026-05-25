import { describe, expect, it } from 'vitest';
import { encodeWAV, parseWAV } from '../../src/codecs/wav.js';

describe('wav codec', () => {
  it('round-trips PCM through encodeWAV → parseWAV', () => {
    const pcm = new Uint8Array(64);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = i;
    const wav = encodeWAV(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
    const parsed = parseWAV(wav);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(Array.from(parsed.pcm)).toEqual(Array.from(pcm));
  });

  it('rejects an undersized WAV', () => {
    expect(() => parseWAV(new Uint8Array(10))).toThrow();
  });
});
