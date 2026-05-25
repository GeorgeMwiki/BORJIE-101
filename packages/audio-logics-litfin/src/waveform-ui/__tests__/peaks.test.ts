import { describe, it, expect } from 'vitest';
import { generateWaveformPeaks, extractSpeakerTimeline } from '../index.js';
import type { AudioSample } from '../../types.js';
import type { DiarizationSegment } from '../index.js';

function makeAudio(): AudioSample {
  const arr = new Uint8Array(4096);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = 128 + Math.floor(64 * Math.sin(i / 30));
  }
  return { bytes: arr, format: 'pcm', sampleRate: 16000, channels: 1, durationMs: 256 };
}

describe('generateWaveformPeaks', () => {
  it('returns one peak per bucket at the requested resolution', () => {
    const spec = generateWaveformPeaks(makeAudio(), { resolution: 50 });
    expect(spec.peaks).toHaveLength(50);
    expect(spec.bucketCount).toBe(50);
    expect(spec.durationMs).toBeGreaterThan(0);
  });

  it('defaults to 200 buckets', () => {
    const spec = generateWaveformPeaks(makeAudio());
    expect(spec.peaks).toHaveLength(200);
  });

  it('returns peaks in [0,1]', () => {
    const spec = generateWaveformPeaks(makeAudio(), { resolution: 32 });
    for (const p of spec.peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('throws on empty audio', () => {
    expect(() =>
      generateWaveformPeaks({
        bytes: new Uint8Array(),
        format: 'pcm',
        sampleRate: 16000,
        channels: 1,
      }),
    ).toThrow(/empty/);
  });

  it('throws on invalid resolution', () => {
    expect(() => generateWaveformPeaks(makeAudio(), { resolution: 0 })).toThrow(/resolution/);
    expect(() => generateWaveformPeaks(makeAudio(), { resolution: -1 })).toThrow(/resolution/);
  });
});

describe('extractSpeakerTimeline', () => {
  it('returns one segment per diarization entry with a consistent color per speaker', () => {
    const diarization: DiarizationSegment[] = [
      { speakerId: 'sp_A', startMs: 0, endMs: 1000, speakerLabel: 'Tenant' },
      { speakerId: 'sp_B', startMs: 1000, endMs: 2000, speakerLabel: 'Agent' },
      { speakerId: 'sp_A', startMs: 2000, endMs: 3000 },
    ];
    const out = extractSpeakerTimeline(diarization);
    expect(out).toHaveLength(3);
    expect(out[0]!.colorHex).toBe(out[2]!.colorHex);
    expect(out[0]!.colorHex).not.toBe(out[1]!.colorHex);
    expect(out[0]!.speakerLabel).toBe('Tenant');
    expect(out[2]!.speakerLabel).toBe('sp_A'); // falls back to id when label absent
  });

  it('returns an empty array for empty input', () => {
    expect(extractSpeakerTimeline([])).toHaveLength(0);
  });
});
