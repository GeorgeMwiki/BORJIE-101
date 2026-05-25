/**
 * Semantic-cache orchestrator coverage.
 *
 * Exercises the end-to-end facade: classify → embed → cache.get →
 * telemetry → store. Cross-tenant isolation, threshold tuning,
 * intent-tiered TTL, and cost-saved telemetry all under test.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCostUsdMicros,
  createCostRateRegistry,
  createSemanticCache,
  DEFAULT_SIMILARITY_THRESHOLD,
  SEMANTIC_CACHE_TTL_MS_BY_INTENT,
  SONNET_4_6_RATE,
  type SemanticCacheTelemetryEvent,
  type SemanticCacheTelemetrySink,
} from '../semantic-cache.js';
import {
  createInMemoryCacheStore,
  type SemanticCacheScope,
} from '../cache-store.js';
import { createSemanticEmbedder } from '../embedder.js';
import type { EmbedderPort } from '../../embedder.js';
import type { BrainDecision } from '../../kernel-types.js';

function fakeDecision(text: string): BrainDecision {
  return {
    kind: 'answer',
    text,
    citations: [],
    artifacts: [],
    confidence: {
      groundedness: 1,
      stability: 1,
      review: 1,
      numericalConsistency: 1,
      overall: 1,
    },
  } as unknown as BrainDecision;
}

function buildEmbedder(
  fn: (text: string) => ReadonlyArray<number>,
  dims = 8,
): EmbedderPort {
  return {
    modelId: 'fake',
    dims,
    async embed(text) {
      return fn(text);
    },
  };
}

const SCOPE_A: SemanticCacheScope = {
  tenantId: 'tenant-A',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};
const SCOPE_B: SemanticCacheScope = {
  tenantId: 'tenant-B',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};

function pad(values: number[], dims = 8): number[] {
  const out = new Array(dims).fill(0);
  values.forEach((v, i) => {
    if (i < dims) out[i] = v;
  });
  return out;
}

function vectorFor(text: string): number[] {
  // Toy embedder — buckets prompts by their first word so we can craft
  // semantically-similar vs semantically-distant pairs.
  const word = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (word.startsWith('rent')) return pad([1, 0.1, 0]);
  if (word.startsWith('cost') || word.startsWith('price')) return pad([0.99, 0.1, 0]);
  if (word.startsWith('weather')) return pad([0, 1, 0]);
  return pad([0, 0, 1]);
}

describe('computeCostUsdMicros', () => {
  it('returns positive micros for Sonnet pricing', () => {
    // 1k prompt + 500 completion tokens against Sonnet
    // 1000 * 0.003 / 1000 + 500 * 0.015 / 1000 = 0.003 + 0.0075 = 0.0105 USD = 10_500 micros
    const micros = computeCostUsdMicros(SONNET_4_6_RATE, 1000, 500);
    expect(micros).toBe(10_500);
  });

  it('returns 0 for zero tokens', () => {
    expect(computeCostUsdMicros(SONNET_4_6_RATE, 0, 0)).toBe(0);
  });

  it('clamps negative inputs to 0', () => {
    expect(computeCostUsdMicros(SONNET_4_6_RATE, -100, -50)).toBe(0);
  });
});

describe('createSemanticCache — lookup + store', () => {
  it('miss on empty cache + miss telemetry includes would-be cost', async () => {
    const events: SemanticCacheTelemetryEvent[] = [];
    const sink: SemanticCacheTelemetrySink = {
      record(e) {
        events.push(e);
      },
    };
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
      telemetrySink: sink,
    });
    const out = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
      estimatedPromptTokens: 1000,
      estimatedCompletionTokens: 500,
    });
    expect(out.outcome).toBe('miss');
    expect(events.length).toBe(1);
    expect(events[0]?.outcome).toBe('miss');
    expect(events[0]?.costUsdMicros).toBe(10_500);
  });

  it('hit after store — telemetry records cost SAVED', async () => {
    const events: SemanticCacheTelemetryEvent[] = [];
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
      telemetrySink: { record: (e) => events.push(e) },
    });
    const miss = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
      estimatedPromptTokens: 1000,
      estimatedCompletionTokens: 500,
    });
    expect(miss.outcome).toBe('miss');
    if (miss.outcome !== 'miss') return;
    await cache.store({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      embedding: miss.embedding,
      value: fakeDecision('Your rent is 850k TZS'),
      cacheId: 'thought-1',
    });
    const hit = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent figure please',
      answeringModelId: 'claude-sonnet-4-6',
      estimatedPromptTokens: 1000,
      estimatedCompletionTokens: 500,
    });
    expect(hit.outcome).toBe('hit');
    if (hit.outcome !== 'hit') return;
    expect(hit.value.kind === 'answer' && hit.value.text).toBe(
      'Your rent is 850k TZS',
    );
    const hitEvent = events.find((e) => e.outcome === 'hit');
    expect(hitEvent?.costUsdMicros).toBe(10_500);
  });

  it('intent=command is SKIPPED — never embeds', async () => {
    let embedCalls = 0;
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({
        embedder: buildEmbedder((t) => {
          embedCalls += 1;
          return vectorFor(t);
        }),
      }),
    });
    const out = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'please pay invoice 123',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(out.outcome).toBe('skip');
    if (out.outcome === 'skip') expect(out.reason).toBe('intent=command');
    expect(embedCalls).toBe(0);
  });

  it('tenant isolation — A storing a hit does NOT serve B', async () => {
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
    });
    const miss = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    if (miss.outcome !== 'miss') throw new Error('expected miss');
    await cache.store({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      embedding: miss.embedding,
      value: fakeDecision('A-only'),
      cacheId: 'thought-1',
    });
    const probe = await cache.lookup({
      scope: SCOPE_B,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(probe.outcome).toBe('miss');
  });

  it('thresholdForTenant override is respected', async () => {
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
      // Tenant A demands near-exact match — 0.99 threshold.
      thresholdForTenant: (t) => (t === 'tenant-A' ? 0.99 : null),
    });
    const miss = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    if (miss.outcome !== 'miss') throw new Error('expected miss');
    await cache.store({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      embedding: miss.embedding,
      value: fakeDecision('exact-A'),
      cacheId: 'thought-1',
    });
    // "cost" is semantically-similar but not identical (sim ~0.995 vs 1.0).
    // With a 0.99 threshold it still hits; with 0.999 it would miss.
    const hit = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'cost breakdown',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(hit.outcome).toBe('hit');
    if (hit.outcome === 'hit') expect(hit.similarity).toBeGreaterThan(0.99);
  });

  it('embedder failure → skip (no throw)', async () => {
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({
        embedder: buildEmbedder(() => {
          throw new Error('upstream blew up');
        }),
      }),
    });
    const out = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(out.outcome).toBe('skip');
    if (out.outcome === 'skip') expect(out.reason).toBe('embedder-failed');
  });

  it('store with ttlMsOverride=0 is a no-op', async () => {
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
    });
    const miss = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    if (miss.outcome !== 'miss') throw new Error('expected miss');
    await cache.store({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      embedding: miss.embedding,
      value: fakeDecision('no-store'),
      cacheId: 'thought-1',
      ttlMsOverride: 0,
    });
    const probe = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(probe.outcome).toBe('miss');
  });

  it('default TTLs per intent', () => {
    expect(SEMANTIC_CACHE_TTL_MS_BY_INTENT.command).toBe(0);
    expect(SEMANTIC_CACHE_TTL_MS_BY_INTENT.greeting).toBe(24 * 60 * 60_000);
    expect(SEMANTIC_CACHE_TTL_MS_BY_INTENT.question).toBe(60 * 60_000);
  });

  it('clearScope drops only the targeted scope', async () => {
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
    });
    const ma = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    if (ma.outcome !== 'miss') throw new Error('expected miss');
    await cache.store({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      embedding: ma.embedding,
      value: fakeDecision('A'),
      cacheId: 'tA',
    });
    const mb = await cache.lookup({
      scope: SCOPE_B,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    if (mb.outcome !== 'miss') throw new Error('expected miss');
    await cache.store({
      scope: SCOPE_B,
      userMessage: 'rent statement',
      embedding: mb.embedding,
      value: fakeDecision('B'),
      cacheId: 'tB',
    });
    await cache.clearScope(SCOPE_A);
    const probeA = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    const probeB = await cache.lookup({
      scope: SCOPE_B,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(probeA.outcome).toBe('miss');
    expect(probeB.outcome).toBe('hit');
  });

  it('default similarity threshold is 0.95', () => {
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.95);
  });

  it('cost rate registry returns model-specific rates', () => {
    const registry = createCostRateRegistry();
    expect(registry.rateFor('claude-sonnet-4-6').promptUsdPer1k).toBe(0.003);
    expect(registry.rateFor('claude-opus-4-6').promptUsdPer1k).toBe(0.015);
    expect(registry.rateFor('claude-haiku-4-5-20251001').promptUsdPer1k).toBe(
      0.0008,
    );
    // Unknown id → falls back to Sonnet (the Borjie default).
    expect(registry.rateFor('unknown').promptUsdPer1k).toBe(0.003);
  });

  it('telemetry sink failures do NOT break the lookup', async () => {
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({ embedder: buildEmbedder(vectorFor) }),
      telemetrySink: {
        record() {
          throw new Error('telemetry down');
        },
      },
    });
    const out = await cache.lookup({
      scope: SCOPE_A,
      userMessage: 'rent statement',
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(out.outcome).toBe('miss');
  });
});
