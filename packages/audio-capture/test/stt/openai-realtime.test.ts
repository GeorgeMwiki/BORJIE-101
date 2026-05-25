import { describe, expect, it, vi } from 'vitest';
import { createOpenAIRealtimeAdapter } from '../../src/stt/openai-realtime.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(4),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createOpenAIRealtimeAdapter', () => {
  it('refuses to transcribe without an API key', async () => {
    const adapter = createOpenAIRealtimeAdapter({ apiKey: undefined });
    await expect(adapter.transcribe({ audio: audio() })).rejects.toBeInstanceOf(
      AudioCaptureError,
    );
  });

  it('maps verbose_json into TranscriptSegments with timestamps', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          text: 'good morning team',
          language: 'en',
          duration: 1.4,
          segments: [
            { text: 'good morning', start: 0.0, end: 0.7, avg_logprob: -0.1 },
            { text: 'team', start: 0.7, end: 1.4, avg_logprob: -0.05 },
          ],
        }),
      ),
    );
    const adapter = createOpenAIRealtimeAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    const result = await adapter.transcribe({ audio: audio(), language: 'en' });
    expect(result.transcript).toBe('good morning team');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.startMs).toBe(0);
    expect(result.segments[0]?.endMs).toBe(700);
    expect(result.segments[0]?.confidence).toBeGreaterThan(0);
    expect(result.durationMs).toBe(1400);
  });

  it('sends the API key via Bearer auth', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: '', segments: [] })),
    );
    const adapter = createOpenAIRealtimeAdapter({ apiKey: 'sk-test', fetchImpl: fetchMock });
    await adapter.transcribe({ audio: audio() });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer sk-test');
  });

  it('streams by collecting chunks and yielding mapped segments', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          text: 'hi',
          language: 'en',
          duration: 0.1,
          segments: [{ text: 'hi', start: 0, end: 0.1 }],
        }),
      ),
    );
    const adapter = createOpenAIRealtimeAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    const chunks = (async function* () {
      yield audio();
    })();
    const segments = [];
    for await (const seg of adapter.streamTranscribe(chunks)) {
      segments.push(seg);
    }
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('hi');
  });
});
