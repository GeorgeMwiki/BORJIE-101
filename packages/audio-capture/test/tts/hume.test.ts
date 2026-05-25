import { describe, expect, it, vi } from 'vitest';
import { createHumeAdapter } from '../../src/tts/hume.js';
import { AudioCaptureError } from '../../src/types.js';

describe('createHumeAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createHumeAdapter({ apiKey: undefined });
    await expect(
      adapter.synthesize({ text: 'hi', voiceId: 'v', format: 'mp3' }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('decodes base64 audio and surfaces emotion in the body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          audio_base64: Buffer.from(new Uint8Array([7, 8, 9])).toString('base64'),
          duration_ms: 200,
        }),
      ),
    );
    const adapter = createHumeAdapter({ apiKey: 'hk', fetchImpl: fetchMock });
    const result = await adapter.synthesize({
      text: 'sorry',
      voiceId: 'mwikila',
      format: 'mp3',
      emotion: { tone: 'apologetic', intensity: 0.7 },
    });
    expect(Array.from(result.audio.bytes)).toEqual([7, 8, 9]);
    expect(result.audio.durationMs).toBe(200);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const sent = JSON.parse(String(init.body));
    expect(sent.prosody.emotion).toBe('apologetic');
    expect(sent.prosody.intensity).toBeCloseTo(0.7);
  });

  it('streams by slicing the one-shot synthesis', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          audio_base64: Buffer.from(new Uint8Array(8192)).toString('base64'),
        }),
      ),
    );
    const adapter = createHumeAdapter({ apiKey: 'hk', fetchImpl: fetchMock });
    const chunks = [];
    for await (const c of adapter.streamSynthesize({
      text: 'x',
      voiceId: 'v',
      format: 'mp3',
    })) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });
});
