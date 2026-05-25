/**
 * Unit tests for the OpenAI embedder + null embedder.
 *
 * Coverage:
 *   1. happy path: fetch is called with the right URL/headers/body,
 *      vector returned has the expected dims
 *   2. retry on 5xx — succeeds on the third attempt
 *   3. no-retry on 4xx — throws after the first attempt
 *   4. dim mismatch — throws (no silent fallback)
 *   5. empty data array — throws
 *   6. null embedder rejects with EmbedderNotConfigured
 *   7. transport / abort error retries then surfaces
 *   8. multiple concurrent embeds do not share state across calls
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createOpenAiEmbedder,
  createNullEmbedder,
  EMBEDDER_NOT_CONFIGURED_ERROR,
} from '../embedder.js';

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buildVector(dims: number, seed = 0.01): number[] {
  return Array.from({ length: dims }, (_, i) => seed + i * 1e-4);
}

describe('createOpenAiEmbedder', () => {
  it('happy path — calls /v1/embeddings with bearer auth and returns the vector', async () => {
    const vec = buildVector(1536);
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer sk-test');
      expect(headers['content-type']).toBe('application/json');
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.input).toBe('hello');
      return makeJsonResponse({ data: [{ embedding: vec }] });
    });

    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      random: () => 0,
    });

    const out = await embedder.embed('hello');
    expect(out).toHaveLength(1536);
    expect(embedder.modelId).toBe('openai:text-embedding-3-small');
    expect(embedder.dims).toBe(1536);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds on the third attempt', async () => {
    const vec = buildVector(1536);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('upstream down', { status: 503 });
      }
      return makeJsonResponse({ data: [{ embedding: vec }] });
    });

    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
      random: () => 0,
    });

    const out = await embedder.embed('hi');
    expect(out).toHaveLength(1536);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx — fails fast after one attempt', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 }));
    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-wrong',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
      random: () => 0,
    });

    await expect(embedder.embed('x')).rejects.toThrow(/HTTP 401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws on dim mismatch — no silent fallback', async () => {
    const fetchImpl = vi.fn(async () =>
      // 1024 dims when 1536 was expected.
      makeJsonResponse({ data: [{ embedding: buildVector(1024) }] }),
    );
    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      random: () => 0,
    });

    await expect(embedder.embed('x')).rejects.toThrow(/dim mismatch/);
  });

  it('throws on empty data array (provider returned no embedding)', async () => {
    const fetchImpl = vi.fn(async () => makeJsonResponse({ data: [] }));
    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      random: () => 0,
    });

    await expect(embedder.embed('x')).rejects.toThrow(/empty vector/);
  });

  it('retries on transport failures and surfaces the last error', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      throw new TypeError('fetch failed: ECONNRESET');
    });
    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
      random: () => 0,
    });

    await expect(embedder.embed('x')).rejects.toThrow(/transport failure/);
    // 1 initial + 2 retries = 3 calls.
    expect(calls).toBe(3);
  });

  it('aborts on timeout (transport-error path)', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Simulate the AbortController by listening to signal.
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
      maxRetries: 0,
      random: () => 0,
    });

    await expect(embedder.embed('x')).rejects.toThrow(/transport failure/);
  });

  it('concurrent embeds do not share state — each call returns its own vector', async () => {
    const vecA = buildVector(1536, 0.01);
    const vecB = buildVector(1536, 0.99);
    let next = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const out = body.input === 'A' ? vecA : vecB;
      next += 1;
      return makeJsonResponse({ data: [{ embedding: out }] });
    });
    const embedder = createOpenAiEmbedder({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      random: () => 0,
    });

    const [outA, outB] = await Promise.all([
      embedder.embed('A'),
      embedder.embed('B'),
    ]);
    expect(outA[0]).toBeCloseTo(0.01);
    expect(outB[0]).toBeCloseTo(0.99);
    expect(next).toBe(2);
  });

  it('throws at construction time when apiKey is missing', () => {
    expect(() =>
      createOpenAiEmbedder({ apiKey: '' } as unknown as { apiKey: string }),
    ).toThrow(/apiKey is required/);
  });
});

describe('createNullEmbedder', () => {
  it('always rejects with the sentinel error message', async () => {
    const embedder = createNullEmbedder();
    expect(embedder.modelId).toBe('null');
    expect(embedder.dims).toBe(0);
    await expect(embedder.embed('whatever')).rejects.toThrow(
      EMBEDDER_NOT_CONFIGURED_ERROR,
    );
  });
});
