import { describe, expect, it, vi } from 'vitest';
import { createElevenLabsVoiceLab } from '../../src/voice-clone/elevenlabs-voice-lab.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const sample = (): AudioChunk => ({
  bytes: new Uint8Array([1, 2, 3, 4]),
  format: 'wav',
  sampleRate: 24000,
  channels: 1,
});

describe('createElevenLabsVoiceLab', () => {
  it('requires an API key', async () => {
    const lab = createElevenLabsVoiceLab({ apiKey: undefined });
    await expect(
      lab.createClone({ name: 'mwikila', samples: [{ audio: sample() }] }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('requires at least one sample', async () => {
    const lab = createElevenLabsVoiceLab({ apiKey: 'k', fetchImpl: vi.fn() });
    await expect(
      lab.createClone({ name: 'mwikila', samples: [] }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('returns a reusable VoiceClone with multilingual support', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ voice_id: 'vid_123', name: 'mr-mwikila' })),
    );
    const lab = createElevenLabsVoiceLab({ apiKey: 'k', fetchImpl: fetchMock });
    const clone = await lab.createClone({
      name: 'mr-mwikila',
      samples: [{ audio: sample(), language: 'sw' }],
      languages: ['en', 'sw'],
    });
    expect(clone.id).toBe('vid_123');
    expect(clone.supportedLanguages).toEqual(['en', 'sw']);
    expect(clone.supportedEmotions).toContain('apologetic');
    expect(clone.sampleRate).toBe(24000);
  });
});
