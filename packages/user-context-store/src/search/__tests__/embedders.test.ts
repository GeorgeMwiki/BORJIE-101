import { describe, expect, it } from 'vitest';
import { createMockEmbedder, createOpenAIEmbedder } from '../embedders.js';

describe('createMockEmbedder', () => {
  it('produces deterministic output (same input → same vector)', async () => {
    const e = createMockEmbedder({ dimension: 64 });
    const v1 = await e.embed('hello world');
    const v2 = await e.embed('hello world');
    expect(v1).toEqual(v2);
  });

  it('produces different output for different input', async () => {
    const e = createMockEmbedder({ dimension: 32 });
    const v1 = await e.embed('alpha');
    const v2 = await e.embed('beta');
    expect(v1).not.toEqual(v2);
  });

  it('respects the configured dimension', async () => {
    const e = createMockEmbedder({ dimension: 128 });
    const v = await e.embed('test');
    expect(v.length).toBe(128);
  });

  it('values are in [-1, 1]', async () => {
    const e = createMockEmbedder({ dimension: 256 });
    const v = await e.embed('range-check');
    for (const n of v) {
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('defaults to 1536 dimensions when not specified', async () => {
    const e = createMockEmbedder();
    expect(e.dimension).toBe(1536);
  });

  it('throws on non-positive dimension', () => {
    expect(() => createMockEmbedder({ dimension: 0 })).toThrow();
  });
});

describe('createOpenAIEmbedder', () => {
  it('throws when apiKey missing', () => {
    expect(() => createOpenAIEmbedder({ apiKey: '' })).toThrow();
  });

  it('exposes dimension 1536', () => {
    const e = createOpenAIEmbedder({ apiKey: 'sk-test' });
    expect(e.dimension).toBe(1536);
  });

  it('uses injected fetch and returns the parsed vector', async () => {
    const fakeVector = Array.from({ length: 1536 }, (_, i) => i / 1536);
    const fakeFetch = async () =>
      new Response(JSON.stringify({ data: [{ embedding: fakeVector }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const e = createOpenAIEmbedder({ apiKey: 'sk-test', fetchImpl: fakeFetch as typeof fetch });
    const v = await e.embed('hi');
    expect(v).toEqual(fakeVector);
  });

  it('throws on non-2xx', async () => {
    const fakeFetch = async () => new Response('boom', { status: 500 });
    const e = createOpenAIEmbedder({ apiKey: 'sk-test', fetchImpl: fakeFetch as typeof fetch });
    await expect(e.embed('hi')).rejects.toThrow();
  });
});
