import { describe, it, expect } from 'vitest';
import { scoreAudioQuality } from '../index.js';
import type { AudioSample } from '../../types.js';

function tone(length: number, amplitude: number, sampleRate: AudioSample['sampleRate'] = 16000): AudioSample {
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = 128 + Math.floor(amplitude * Math.sin(i / 30));
  }
  return { bytes: arr, format: 'pcm', sampleRate, channels: 1, durationMs: 0 };
}

describe('scoreAudioQuality', () => {
  it('returns a populated quality score with a clean sine tone', () => {
    const score = scoreAudioQuality(tone(4096, 60));
    expect(score.mosLike).toBeGreaterThan(1);
    expect(score.mosLike).toBeLessThanOrEqual(5);
    expect(score.snrDb).toBeGreaterThan(0);
    expect(score.clippingFraction).toBeGreaterThanOrEqual(0);
    expect(score.bandwidthHz).toBe(8000); // 16 kHz sampleRate → 8 kHz BW
  });

  it('flags heavy clipping when the signal saturates', () => {
    const arr = new Uint8Array(4096);
    for (let i = 0; i < arr.length; i++) arr[i] = i % 2 === 0 ? 0 : 255;
    const score = scoreAudioQuality({
      bytes: arr,
      format: 'pcm',
      sampleRate: 16000,
      channels: 1,
    });
    expect(score.issues).toContain('heavy-clipping');
    expect(score.clippingFraction).toBeGreaterThan(0.5);
  });

  it('flags narrowband when sample rate is 8 kHz', () => {
    const score = scoreAudioQuality(tone(4096, 60, 8000));
    expect(score.issues).toContain('narrowband-only');
  });

  it('flags silent when the audio is all-zero amplitude', () => {
    const arr = new Uint8Array(4096).fill(128);
    const score = scoreAudioQuality({
      bytes: arr,
      format: 'pcm',
      sampleRate: 16000,
      channels: 1,
    });
    expect(score.issues).toContain('silent');
    expect(score.acceptableForEvidence).toBe(false);
  });

  it('accepts a clean tone for evidence storage', () => {
    const score = scoreAudioQuality(tone(8192, 40, 48000));
    expect(score.acceptableForEvidence).toBe(true);
  });

  it('throws on empty input', () => {
    expect(() =>
      scoreAudioQuality({
        bytes: new Uint8Array(),
        format: 'pcm',
        sampleRate: 16000,
        channels: 1,
      }),
    ).toThrow(/empty/);
  });
});
