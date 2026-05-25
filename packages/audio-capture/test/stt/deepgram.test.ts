import { describe, expect, it, vi } from 'vitest';
import { createDeepgramAdapter } from '../../src/stt/deepgram.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(8),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createDeepgramAdapter', () => {
  it('throws NO_API_KEY when no key is configured', async () => {
    const adapter = createDeepgramAdapter({ apiKey: undefined });
    await expect(adapter.transcribe({ audio: audio() })).rejects.toBeInstanceOf(
      AudioCaptureError,
    );
  });

  it('POSTs the audio bytes to the listen endpoint with Token auth', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: 'hello world',
                    confidence: 0.97,
                    words: [
                      { word: 'hello', start: 0.0, end: 0.4, speaker: 0, confidence: 0.95 },
                      { word: 'world', start: 0.4, end: 0.8, speaker: 0, confidence: 0.92 },
                    ],
                  },
                ],
                detected_language: 'en',
              },
            ],
          },
          metadata: { duration: 0.8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = createDeepgramAdapter({
      apiKey: 'test_key',
      fetchImpl: fetchMock,
    });
    const result = await adapter.transcribe({
      audio: audio(),
      language: 'en',
      diarize: true,
    });
    expect(result.transcript).toBe('hello world');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.speakerId).toBe('spk_0');
    expect(result.durationMs).toBe(800);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toMatch(/diarize=true/);
    expect(url).toMatch(/model=nova-3/);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe('Token test_key');
  });

  it('maps detect_language when no language is supplied', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: { channels: [{ alternatives: [{ transcript: 'salama' }], detected_language: 'sw' }] },
          metadata: { duration: 0.5 },
        }),
      ),
    );
    const adapter = createDeepgramAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    const result = await adapter.transcribe({ audio: audio() });
    expect(result.language).toBe('sw');
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/detect_language=true/);
  });

  it('streams by collecting chunks and emitting final segments', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: {
            channels: [
              {
                alternatives: [
                  { transcript: 'hi', words: [{ word: 'hi', start: 0, end: 0.2 }] },
                ],
                detected_language: 'en',
              },
            ],
          },
          metadata: { duration: 0.2 },
        }),
      ),
    );
    const adapter = createDeepgramAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    const chunks = (async function* () {
      yield audio();
      yield audio();
    })();
    const segments = [];
    for await (const seg of adapter.streamTranscribe(chunks)) {
      segments.push(seg);
    }
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('hi');
  });

  it('surfaces upstream errors as AudioCaptureError', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('rate limited', { status: 429 }),
    );
    const adapter = createDeepgramAdapter({ apiKey: 'k', fetchImpl: fetchMock });
    await expect(
      adapter.transcribe({ audio: audio() }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });
});
