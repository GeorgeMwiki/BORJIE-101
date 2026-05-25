import { describe, expect, it, vi } from 'vitest';
import { createElevenLabsAdapter } from '../../src/tts/elevenlabs.js';
import { AudioCaptureError } from '../../src/types.js';

const audioRes = (bytes: Uint8Array) => new Response(bytes, { status: 200 });

describe('createElevenLabsAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createElevenLabsAdapter({ apiKey: undefined });
    await expect(
      adapter.synthesize({ text: 'hi', voiceId: 'v', format: 'mp3' }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('POSTs to /v1/text-to-speech/:voiceId with xi-api-key', async () => {
    const fetchMock = vi.fn(async () => audioRes(new Uint8Array([1, 2, 3])));
    const adapter = createElevenLabsAdapter({
      apiKey: 'ek',
      voiceId: 'default',
      fetchImpl: fetchMock,
    });
    const result = await adapter.synthesize({
      text: 'hi',
      voiceId: 'rachel',
      format: 'mp3',
    });
    expect(result.audio.bytes).toEqual(new Uint8Array([1, 2, 3]));
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/text-to-speech\/rachel$/);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('ek');
  });

  it('streams chunks from the response body', async () => {
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const adapter = createElevenLabsAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    const chunks = [];
    for await (const c of adapter.streamSynthesize({
      text: 'hi',
      voiceId: 'v',
      format: 'mp3',
    })) {
      chunks.push(c);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.sequence).toBe(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/stream$/);
  });

  it('escalates upstream errors', async () => {
    const fetchMock = vi.fn(async () => new Response('quota', { status: 429 }));
    const adapter = createElevenLabsAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    await expect(
      adapter.synthesize({ text: 'hi', voiceId: 'v', format: 'mp3' }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });
});
