/**
 * Semantic-cache embedder wrapper coverage.
 *
 * - prompt-hash caching collapses repeated embed() calls to one
 * - failures degrade to null (no throw)
 * - different scopes never share an embedding cache entry
 * - LRU eviction past capacity
 * - TTL respect
 */

import { describe, it, expect } from 'vitest';
import { createSemanticEmbedder } from '../embedder.js';
import type { EmbedderPort } from '../../embedder.js';
import type { SemanticCacheScope } from '../cache-store.js';

const SCOPE: SemanticCacheScope = {
  tenantId: 't1',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};
const SCOPE_B: SemanticCacheScope = {
  tenantId: 't2',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};

function buildEmbedder(
  impl: (text: string) => ReadonlyArray<number> | Promise<ReadonlyArray<number>>,
  modelId = 'openai:text-embedding-3-small',
  dims = 4,
): EmbedderPort {
  return {
    modelId,
    dims,
    async embed(text) {
      return await Promise.resolve(impl(text));
    },
  };
}

describe('createSemanticEmbedder', () => {
  it('caches identical (scope, prompt) — embed only fires once', async () => {
    let calls = 0;
    const inner = buildEmbedder((text) => {
      calls += 1;
      return [text.length, 0, 0, 0];
    });
    const emb = createSemanticEmbedder({ embedder: inner });
    await emb.embedForCache(SCOPE, 'hello');
    await emb.embedForCache(SCOPE, 'hello');
    await emb.embedForCache(SCOPE, 'hello');
    expect(calls).toBe(1);
  });

  it('different scopes do NOT share the embedding cache', async () => {
    let calls = 0;
    const inner = buildEmbedder((text) => {
      calls += 1;
      return [text.length, 0, 0, 0];
    });
    const emb = createSemanticEmbedder({ embedder: inner });
    await emb.embedForCache(SCOPE, 'hello');
    await emb.embedForCache(SCOPE_B, 'hello');
    expect(calls).toBe(2);
  });

  it('returns null when the underlying embedder throws', async () => {
    const inner = buildEmbedder(() => {
      throw new Error('EmbedderNotConfigured');
    });
    const warns: string[] = [];
    const emb = createSemanticEmbedder({
      embedder: inner,
      logger: { warn: (m) => warns.push(m) },
    });
    const out = await emb.embedForCache(SCOPE, 'hello');
    expect(out).toBeNull();
    expect(warns.length).toBe(1);
  });

  it('returns null for empty prompt', async () => {
    const inner = buildEmbedder(() => [1, 0, 0, 0]);
    const emb = createSemanticEmbedder({ embedder: inner });
    expect(await emb.embedForCache(SCOPE, '')).toBeNull();
  });

  it('respects ttl — expired entry re-embeds', async () => {
    let now = 0;
    let calls = 0;
    const inner = buildEmbedder(() => {
      calls += 1;
      return [1, 0, 0, 0];
    });
    const emb = createSemanticEmbedder({
      embedder: inner,
      cacheTtlMs: 100,
      clock: () => now,
    });
    await emb.embedForCache(SCOPE, 'hi');
    now = 50;
    await emb.embedForCache(SCOPE, 'hi'); // still cached
    now = 300; // past expiry
    await emb.embedForCache(SCOPE, 'hi');
    expect(calls).toBe(2);
  });

  it('LRU eviction past capacity', async () => {
    let calls = 0;
    const inner = buildEmbedder((text) => {
      calls += 1;
      return [text.length, 0, 0, 0];
    });
    const emb = createSemanticEmbedder({ embedder: inner, cacheCapacity: 2 });
    await emb.embedForCache(SCOPE, 'a');
    await emb.embedForCache(SCOPE, 'b');
    await emb.embedForCache(SCOPE, 'c'); // evicts 'a'
    await emb.embedForCache(SCOPE, 'a'); // re-embed
    expect(calls).toBe(4);
  });

  it('exposes modelId + dims from the underlying embedder', () => {
    const inner = buildEmbedder(() => [0, 0], 'voyage-large-2', 2);
    const emb = createSemanticEmbedder({ embedder: inner });
    expect(emb.modelId).toBe('voyage-large-2');
    expect(emb.dims).toBe(2);
  });

  it('throws synchronously when no embedder is supplied', () => {
    expect(() =>
      createSemanticEmbedder({ embedder: null as unknown as EmbedderPort }),
    ).toThrow();
  });

  it('clearCache() flushes the prompt-hash cache', async () => {
    let calls = 0;
    const inner = buildEmbedder(() => {
      calls += 1;
      return [1, 0, 0, 0];
    });
    const emb = createSemanticEmbedder({ embedder: inner });
    await emb.embedForCache(SCOPE, 'hello');
    emb.clearCache();
    await emb.embedForCache(SCOPE, 'hello');
    expect(calls).toBe(2);
  });
});
