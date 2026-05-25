import { describe, expect, it } from 'vitest';
import { createMockTTSAdapter } from '../../src/tts/mock.js';

describe('createMockTTSAdapter', () => {
  it('synthesises bytes proportional to text length', async () => {
    const adapter = createMockTTSAdapter({ bytesPerChar: 16 });
    const result = await adapter.synthesize({
      text: 'hello',
      voiceId: 'rachel',
      format: 'mp3',
    });
    expect(result.characters).toBe(5);
    expect(result.audio.bytes.byteLength).toBe(5 * 16);
    expect(result.audio.sampleRate).toBe(24000);
    expect(result.voiceId).toBe('rachel');
  });

  it('streams exactly chunkCount chunks', async () => {
    const adapter = createMockTTSAdapter({ chunkCount: 5, bytesPerChar: 20 });
    const chunks = [];
    for await (const c of adapter.streamSynthesize({
      text: 'hello world',
      voiceId: 'v',
      format: 'opus',
    })) {
      chunks.push(c);
    }
    expect(chunks).toHaveLength(5);
    expect(chunks[0]?.format).toBe('opus');
    const total = chunks.reduce((sum, c) => sum + c.bytes.byteLength, 0);
    expect(total).toBe(11 * 20);
  });

  it('returns deterministic bytes for the same input', async () => {
    const adapter = createMockTTSAdapter({ bytesPerChar: 8 });
    const a = await adapter.synthesize({ text: 'x', voiceId: 'v', format: 'wav' });
    const b = await adapter.synthesize({ text: 'x', voiceId: 'v', format: 'wav' });
    expect(Array.from(a.audio.bytes)).toEqual(Array.from(b.audio.bytes));
  });
});
