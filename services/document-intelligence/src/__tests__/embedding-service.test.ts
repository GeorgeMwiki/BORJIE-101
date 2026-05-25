import { describe, it, expect } from 'vitest';
import type { IEmbeddingModelPort } from '../services/embedding-service.js';
import { EmbeddingService, StubEmbeddingModel } from '../services/embedding-service.js';

describe('EmbeddingService', () => {
  const svc = new EmbeddingService({
    model: new StubEmbeddingModel(16),
    chunkSize: 50,
    chunkOverlap: 10,
  });

  it('chunks text into overlapping windows', () => {
    const chunks = svc.chunk('a'.repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(50);
  });

  it('returns empty for empty text', () => {
    expect(svc.chunk('')).toEqual([]);
  });

  it('embeds chunks with dimensions matching the model', async () => {
    const chunks = svc.chunk('hello world');
    const embedded = await svc.embedChunks(chunks);
    expect(embedded).toHaveLength(chunks.length);
    for (const e of embedded) {
      expect(e.embedding.length).toBe(16);
      expect(e.embeddingModel).toBe('stub-embedding-v0');
    }
  });

  // ---------------------------------------------------------------------------
  // Concurrency + batching guarantees (implements Category-A fix from
  // embedChunks — batches are sent in parallel capped at maxConcurrency and
  // each call is bounded by batchSize).
  // ---------------------------------------------------------------------------
  it('splits chunks into DB-bounded batches and respects max concurrency', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const callSizes: number[] = [];

    const tracker: IEmbeddingModelPort = {
      model: 'tracker-v0',
      dimensions: 4,
      async embed(texts) {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        callSizes.push(texts.length);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return texts.map(() => [1, 2, 3, 4]);
      },
    };

    const service = new EmbeddingService({
      model: tracker,
      chunkSize: 10,
      chunkOverlap: 0,
      batchSize: 4,
      maxConcurrency: 2,
    });

    // 20 chunks / batchSize 4 = 5 batches. With maxConcurrency 2, peak
    // in-flight must never exceed 2 even though 5 batches exist.
    const chunks = Array.from({ length: 20 }, (_, i) => ({
      chunkIndex: i,
      text: `chunk-${i}`,
      meta: {},
    }));
    const embedded = await service.embedChunks(chunks);

    expect(embedded).toHaveLength(20);
    expect(peakInFlight).toBeLessThanOrEqual(2);
    expect(callSizes).toHaveLength(5);
    expect(callSizes.every((n) => n <= 4)).toBe(true);
    // Order must be preserved — result[i].chunkIndex === i.
    for (let i = 0; i < embedded.length; i++) {
      expect(embedded[i]!.chunkIndex).toBe(i);
    }
  });

  it('throws when the model returns a mismatched vector count', async () => {
    const badModel: IEmbeddingModelPort = {
      model: 'bad-v0',
      dimensions: 4,
      async embed(texts) {
        // Intentionally return one fewer vector than requested.
        return texts.slice(1).map(() => [0, 0, 0, 0]);
      },
    };
    const service = new EmbeddingService({
      model: badModel,
      chunkSize: 10,
      chunkOverlap: 0,
      batchSize: 3,
      maxConcurrency: 1,
    });
    const chunks = Array.from({ length: 3 }, (_, i) => ({
      chunkIndex: i,
      text: `c${i}`,
      meta: {},
    }));
    await expect(service.embedChunks(chunks)).rejects.toThrow(/embedding count mismatch/);
  });
});
