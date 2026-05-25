import { describe, expect, it, vi } from 'vitest';
import { createCartesiaAdapter } from '../../src/stt/cartesia.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(4),
  format: 'pcm',
  sampleRate: 16000,
  channels: 1,
});

describe('createCartesiaAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createCartesiaAdapter({ apiKey: undefined });
    await expect(adapter.transcribe({ audio: audio() })).rejects.toBeInstanceOf(
      AudioCaptureError,
    );
  });

  it('maps segments and exposes the model id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          transcript: 'unit test',
          language: 'en',
          duration: 0.4,
          segments: [
            {
              text: 'unit test',
              start_ms: 0,
              end_ms: 400,
              is_final: true,
              confidence: 0.91,
            },
          ],
        }),
      ),
    );
    const adapter = createCartesiaAdapter({ apiKey: 'ct', fetchImpl: fetchMock });
    expect(adapter.modelId).toBe('sonic-2');
    const result = await adapter.transcribe({ audio: audio(), diarize: true });
    expect(result.segments[0]?.endMs).toBe(400);
    expect(result.durationMs).toBe(400);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/model=sonic-2/);
    expect(url).toMatch(/diarize=true/);
  });
});
