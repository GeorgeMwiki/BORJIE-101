import { describe, expect, it } from 'vitest';
import { createMockSTTAdapter } from '../../src/stt/mock.js';
import type { AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array([1, 2, 3, 4]),
  format: 'pcm',
  sampleRate: 16000,
  channels: 1,
  durationMs: 320,
});

describe('createMockSTTAdapter', () => {
  it('returns the fixture transcript verbatim', async () => {
    const adapter = createMockSTTAdapter({
      fixture: { transcript: 'hujambo bwana George' },
    });
    const result = await adapter.transcribe({ audio: audio(), language: 'sw' });
    expect(result.transcript).toBe('hujambo bwana George');
    expect(result.language).toBe('sw');
    expect(result.segments[0]?.isFinal).toBe(true);
  });

  it('exposes a stable modelId and provider', () => {
    const adapter = createMockSTTAdapter({
      fixture: { transcript: 'hi' },
      modelId: 'mock-rev1',
    });
    expect(adapter.provider).toBe('mock');
    expect(adapter.modelId).toBe('mock-rev1');
  });

  it('streams partial segments before the final one', async () => {
    const adapter = createMockSTTAdapter({
      fixture: {
        transcript: 'rent is due tomorrow',
        partialChunks: ['rent', 'rent is', 'rent is due'],
      },
    });
    const chunks = (async function* () {
      yield audio();
    })();
    const segments = [];
    for await (const seg of adapter.streamTranscribe(chunks)) {
      segments.push(seg);
    }
    expect(segments.length).toBe(4);
    expect(segments.slice(0, 3).every((s) => !s.isFinal)).toBe(true);
    expect(segments[3]?.isFinal).toBe(true);
    expect(segments[3]?.text).toBe('rent is due tomorrow');
  });

  it('drains audio iterables even when no partials are given', async () => {
    const adapter = createMockSTTAdapter({ fixture: { transcript: 'ok' } });
    let drained = 0;
    const chunks = (async function* () {
      yield audio();
      yield audio();
      drained = 2;
    })();
    const segments = [];
    for await (const seg of adapter.streamTranscribe(chunks)) {
      segments.push(seg);
    }
    expect(drained).toBe(2);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.isFinal).toBe(true);
  });
});
