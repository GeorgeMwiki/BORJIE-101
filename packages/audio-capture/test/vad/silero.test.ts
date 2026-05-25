import { describe, expect, it, vi } from 'vitest';
import { createSileroVAD } from '../../src/vad/silero.js';
import type { AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => {
  const bytes = new Uint8Array(64);
  // PCM16 LE: write some non-zero samples so energy heuristic returns > 0.
  for (let i = 0; i < bytes.length; i += 2) {
    bytes[i] = 0x80;
    bytes[i + 1] = 0x10;
  }
  return { bytes, format: 'pcm', sampleRate: 16000, channels: 1 };
};

describe('createSileroVAD', () => {
  it('uses the injected runner to compute speech probability', async () => {
    const runner = vi.fn(async () => 0.9);
    const vad = createSileroVAD({ modelPath: '/m', runner });
    const result = await vad.detect(audio());
    expect(result.isSpeech).toBe(true);
    expect(result.probability).toBe(0.9);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('treats probabilities below the threshold as silence', async () => {
    const runner = vi.fn(async () => 0.1);
    const vad = createSileroVAD({ modelPath: '/m', runner, threshold: 0.5 });
    const result = await vad.detect(audio());
    expect(result.isSpeech).toBe(false);
  });

  it('streams results per chunk', async () => {
    const runner = vi.fn(async () => 0.6);
    const vad = createSileroVAD({ modelPath: '/m', runner });
    const stream = (async function* () {
      yield audio();
      yield audio();
    })();
    const results = [];
    for await (const r of vad.streamDetect(stream)) results.push(r);
    expect(results).toHaveLength(2);
  });
});
