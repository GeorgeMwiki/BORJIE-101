import { describe, expect, it, vi } from 'vitest';
import { createCartesiaTTSAdapter } from '../../src/tts/cartesia.js';
import { AudioCaptureError } from '../../src/types.js';

describe('createCartesiaTTSAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createCartesiaTTSAdapter({ apiKey: undefined });
    await expect(
      adapter.synthesize({ text: 'hi', voiceId: 'v', format: 'mp3' }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('sends Bearer auth and parses bytes response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
    );
    const adapter = createCartesiaTTSAdapter({ apiKey: 'ct', fetchImpl: fetchMock });
    const result = await adapter.synthesize({
      text: 'salama',
      voiceId: 'sonic-mwikila',
      format: 'mp3',
    });
    expect(Array.from(result.audio.bytes)).toEqual([9, 9, 9]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ct');
  });
});
