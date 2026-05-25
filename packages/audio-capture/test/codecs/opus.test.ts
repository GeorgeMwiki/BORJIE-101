import { describe, expect, it } from 'vitest';
import { decodeOpus, encodeOpus, setOpusRunner } from '../../src/codecs/opus.js';

describe('opus codec helpers', () => {
  it('round-trips PCM through default encoder/decoder', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encoded = encodeOpus(pcm);
    const decoded = decodeOpus(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(pcm));
  });

  it('throws on truncated payloads', () => {
    expect(() => decodeOpus(new Uint8Array(2))).toThrow();
  });

  it('honours injected custom runner', () => {
    setOpusRunner({
      encode: (pcm) => new Uint8Array([0xff, ...pcm]),
      decode: (bytes) => bytes.slice(1),
    });
    try {
      const pcm = new Uint8Array([10, 20, 30]);
      const encoded = encodeOpus(pcm);
      expect(encoded[0]).toBe(0xff);
      const decoded = decodeOpus(encoded);
      expect(Array.from(decoded)).toEqual([10, 20, 30]);
    } finally {
      // Restore default to keep other tests deterministic.
      setOpusRunner({
        encode: (pcm) => {
          const out = new Uint8Array(8 + pcm.byteLength);
          out.set([0x4f, 0x70, 0x75, 0x53], 0);
          new DataView(out.buffer).setUint32(4, pcm.byteLength, true);
          out.set(pcm, 8);
          return out;
        },
        decode: (bytes) => bytes.slice(8),
      });
    }
  });
});
