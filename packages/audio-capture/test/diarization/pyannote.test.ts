import { describe, expect, it, vi } from 'vitest';
import { createPyannoteAdapter } from '../../src/diarization/pyannote.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(16),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createPyannoteAdapter', () => {
  it('requires an API key', async () => {
    const dia = createPyannoteAdapter({ apiKey: undefined });
    await expect(dia.diarize({ audio: audio() })).rejects.toBeInstanceOf(
      AudioCaptureError,
    );
  });

  it('remaps speaker labels to anonymized spk_N indices', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          segments: [
            { speaker: 'SPEAKER_07', start: 0.0, end: 1.2, confidence: 0.95 },
            { speaker: 'SPEAKER_12', start: 1.2, end: 2.4, confidence: 0.91 },
            { speaker: 'SPEAKER_07', start: 2.4, end: 3.6, confidence: 0.94 },
          ],
        }),
      ),
    );
    const dia = createPyannoteAdapter({ apiKey: 'pk', fetchImpl: fetchMock });
    const segments = await dia.diarize({ audio: audio(), expectedSpeakers: 2 });
    expect(segments).toHaveLength(3);
    expect(segments[0]?.speakerId).toBe('spk_0');
    expect(segments[1]?.speakerId).toBe('spk_1');
    expect(segments[2]?.speakerId).toBe('spk_0');
    expect(segments[0]?.endMs).toBe(1200);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/num_speakers=2/);
  });
});
