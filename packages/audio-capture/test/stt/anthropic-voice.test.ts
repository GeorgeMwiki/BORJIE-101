import { describe, expect, it, vi } from 'vitest';
import { createAnthropicVoiceAdapter } from '../../src/stt/anthropic-voice.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array([0, 1, 2, 3]),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createAnthropicVoiceAdapter', () => {
  it('requires an API key', async () => {
    const adapter = createAnthropicVoiceAdapter({ apiKey: undefined });
    await expect(
      adapter.transcribe({ audio: audio() }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('parses an inline JSON transcript from the model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                transcript: 'hello world',
                language: 'en',
                segments: [{ text: 'hello world', startMs: 0, endMs: 500 }],
              }),
            },
          ],
          model: 'claude-opus-4-7-voice',
        }),
      ),
    );
    const adapter = createAnthropicVoiceAdapter({
      apiKey: 'ak',
      fetchImpl: fetchMock,
    });
    const result = await adapter.transcribe({ audio: audio() });
    expect(result.transcript).toBe('hello world');
    expect(result.language).toBe('en');
    expect(result.segments).toHaveLength(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('ak');
  });

  it('falls back to plain text when model returns non-JSON', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'just a plain string' }],
        }),
      ),
    );
    const adapter = createAnthropicVoiceAdapter({
      apiKey: 'ak',
      fetchImpl: fetchMock,
    });
    const result = await adapter.transcribe({ audio: audio() });
    expect(result.transcript).toBe('just a plain string');
  });
});
