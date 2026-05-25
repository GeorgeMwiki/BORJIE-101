import { describe, expect, it } from 'vitest';
import {
  float32ToPcm16,
  pcm16ToFloat32,
  resampleAudio,
} from '../../src/codecs/pcm.js';

describe('pcm codec helpers', () => {
  it('float32 ↔ pcm16 round-trips lossily within tolerance', () => {
    const original = new Float32Array([0, 0.1, -0.1, 0.5, -0.5, 1, -1]);
    const pcm = float32ToPcm16(original);
    const restored = pcm16ToFloat32(pcm);
    for (let i = 0; i < original.length; i += 1) {
      expect(Math.abs((restored[i] ?? 0) - (original[i] ?? 0))).toBeLessThan(0.001);
    }
  });

  it('resampleAudio linear halves the sample count when going 2x → 1x', () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < samples.length; i += 1) samples[i] = i / 100;
    const downsampled = resampleAudio(samples, 16000, 8000, 'linear');
    expect(downsampled.length).toBe(50);
  });

  it('resampleAudio returns a copy when rates match', () => {
    const samples = new Float32Array([1, 2, 3]);
    const out = resampleAudio(samples, 16000, 16000);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out).not.toBe(samples);
  });

  it('resampleAudio sinc mode produces same-length output as linear', () => {
    const samples = new Float32Array(48);
    for (let i = 0; i < 48; i += 1) samples[i] = Math.sin(i / 4);
    const linear = resampleAudio(samples, 48000, 16000, 'linear');
    const sinc = resampleAudio(samples, 48000, 16000, 'sinc');
    expect(linear.length).toBe(sinc.length);
  });

  it('rejects non-positive sample rates', () => {
    expect(() => resampleAudio(new Float32Array(8), 0, 16000)).toThrow();
  });
});
