import { describe, expect, it, vi } from 'vitest';
import { createIntronAdapter } from '../../src/stt/intron.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(4),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createIntronAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createIntronAdapter({ apiKey: undefined, apiEndpoint: 'https://e' });
    await expect(adapter.transcribe({ audio: audio() })).rejects.toBeInstanceOf(
      AudioCaptureError,
    );
  });

  it('defaults to Swahili when no language is supplied', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          transcript: 'habari yako',
          language: 'sw',
          duration_ms: 600,
          segments: [{ text: 'habari yako', start_ms: 0, end_ms: 600, confidence: 0.88 }],
        }),
      ),
    );
    const adapter = createIntronAdapter({
      apiKey: 'ik',
      apiEndpoint: 'https://api.intron.io/v1/transcribe',
      fetchImpl: fetchMock,
    });
    const result = await adapter.transcribe({ audio: audio() });
    expect(result.language).toBe('sw');
    expect(result.transcript).toContain('habari');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/language=sw/);
  });

  it('uses X-API-Key auth, not Bearer', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ transcript: '', segments: [] })),
    );
    const adapter = createIntronAdapter({
      apiKey: 'ik',
      apiEndpoint: 'https://api.intron.io/v1/transcribe',
      fetchImpl: fetchMock,
    });
    await adapter.transcribe({ audio: audio() });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('ik');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
