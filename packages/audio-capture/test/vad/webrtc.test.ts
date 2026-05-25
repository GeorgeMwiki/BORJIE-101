import { describe, expect, it } from 'vitest';
import { createWebRTCVAD } from '../../src/vad/webrtc.js';
import type { AudioChunk } from '../../src/types.js';

const makeAudio = (sampleAmplitude: number): AudioChunk => {
  const samples = new Int16Array(256);
  for (let i = 0; i < samples.length; i += 1) samples[i] = sampleAmplitude;
  return {
    bytes: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    format: 'pcm',
    sampleRate: 16000,
    channels: 1,
  };
};

describe('createWebRTCVAD', () => {
  it('reports silence on a near-zero signal', () => {
    const vad = createWebRTCVAD({ aggressiveness: 1 });
    const result = vad.detect(makeAudio(10));
    expect(result.isSpeech).toBe(false);
  });

  it('reports speech on a loud signal', () => {
    const vad = createWebRTCVAD({ aggressiveness: 0 });
    const result = vad.detect(makeAudio(20000));
    expect(result.isSpeech).toBe(true);
    expect(result.probability).toBeGreaterThan(0.5);
  });
});
