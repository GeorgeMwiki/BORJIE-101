import { describe, expect, it, vi } from 'vitest';
import { createOpenAITTSAdapter } from '../../src/tts/openai.js';
import { AudioCaptureError } from '../../src/types.js';

describe('createOpenAITTSAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createOpenAITTSAdapter({ apiKey: undefined });
    await expect(
      adapter.synthesize({ text: 'hi', voiceId: 'alloy', format: 'mp3' }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('streams bytes from response.body via reader', async () => {
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const adapter = createOpenAITTSAdapter({ apiKey: 'sk', fetchImpl: fetchMock });
    const chunks = [];
    for await (const c of adapter.streamSynthesize({
      text: 'hi',
      voiceId: 'alloy',
      format: 'mp3',
    })) {
      chunks.push(c);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.sequence).toBe(1);
  });
});
