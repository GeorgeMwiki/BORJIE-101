import { describe, expect, it } from 'vitest';
import { createMockVAD } from '../../src/vad/mock.js';
import type { AudioChunk } from '../../src/types.js';

const audio = (seq: number): AudioChunk => ({
  bytes: new Uint8Array(64),
  format: 'pcm',
  sampleRate: 16000,
  channels: 1,
  sequence: seq,
});

describe('createMockVAD', () => {
  it('follows the supplied pattern boolean array', async () => {
    const vad = createMockVAD({ pattern: [true, false, true, false] });
    const results = [vad.detect(audio(0)), vad.detect(audio(1)), vad.detect(audio(2)), vad.detect(audio(3))];
    expect(results.map((r) => r.isSpeech)).toEqual([true, false, true, false]);
  });

  it('reports high probability when classified as speech', () => {
    const vad = createMockVAD({ pattern: [true] });
    const result = vad.detect(audio(0));
    expect(result.probability).toBeGreaterThan(0.5);
    expect(result.isSpeech).toBe(true);
  });

  it('streams a VADResult per chunk', async () => {
    const vad = createMockVAD({ speechRatio: 1 });
    const stream = (async function* () {
      yield audio(0);
      yield audio(1);
      yield audio(2);
    })();
    const results = [];
    for await (const r of vad.streamDetect(stream)) {
      results.push(r);
    }
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.isSpeech)).toBe(true);
  });
});
