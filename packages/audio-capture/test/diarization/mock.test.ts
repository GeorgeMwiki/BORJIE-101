import { describe, expect, it } from 'vitest';
import { createMockDiarization } from '../../src/diarization/mock.js';
import type { AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(64),
  format: 'pcm',
  sampleRate: 16000,
  channels: 1,
  durationMs: 4000,
});

describe('createMockDiarization', () => {
  it('splits the audio into N equal speaker segments', async () => {
    const dia = createMockDiarization();
    const segments = await dia.diarize({ audio: audio(), expectedSpeakers: 4 });
    expect(segments).toHaveLength(4);
    expect(segments[0]?.startMs).toBe(0);
    expect(segments[0]?.endMs).toBe(1000);
    expect(segments[3]?.speakerId).toBe('spk_3');
    expect(segments[3]?.endMs).toBe(4000);
  });

  it('returns the provided fixture verbatim', async () => {
    const fixture = [{ speakerId: 'spk_alice', startMs: 0, endMs: 500 }] as const;
    const dia = createMockDiarization({ fixture });
    const out = await dia.diarize({ audio: audio() });
    expect(out).toEqual(fixture);
  });

  it('defaults to two speakers', async () => {
    const dia = createMockDiarization();
    const out = await dia.diarize({ audio: audio() });
    expect(out).toHaveLength(2);
  });
});
