import { describe, expect, it, vi } from 'vitest';
import { createOpenAIVoiceEngine } from '../../src/voice-clone/openai-voice-engine.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const sample = (): AudioChunk => ({
  bytes: new Uint8Array(8),
  format: 'wav',
  sampleRate: 24000,
  channels: 1,
});

describe('createOpenAIVoiceEngine', () => {
  it('requires an API key', async () => {
    const engine = createOpenAIVoiceEngine({ apiKey: undefined });
    await expect(
      engine.createClone({ name: 'x', samples: [{ audio: sample() }] }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('returns a clone whose languages come from the request', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ voice_id: 'vx', name: 'mwikila' })),
    );
    const engine = createOpenAIVoiceEngine({ apiKey: 'sk', fetchImpl: fetchMock });
    const clone = await engine.createClone({
      name: 'mwikila',
      samples: [{ audio: sample() }],
      languages: ['en', 'sw', 'fr'],
    });
    expect(clone.id).toBe('vx');
    expect(clone.supportedLanguages).toEqual(['en', 'sw', 'fr']);
    expect(clone.provider).toBe('openai');
  });

  it('uses Bearer auth', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ voice_id: 'vx' })),
    );
    const engine = createOpenAIVoiceEngine({ apiKey: 'sk-x', fetchImpl: fetchMock });
    await engine.createClone({ name: 'x', samples: [{ audio: sample() }] });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x');
  });
});
