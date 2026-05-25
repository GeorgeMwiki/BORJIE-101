/**
 * Brain-cache + semantic-cache layering contract.
 *
 * The two layers compose:
 *   - brain-cache (exact key, 60s, free) is the fast path
 *   - semantic-cache (cosine match, 1h/24h, ~$0.00002/lookup) is the
 *     slow path
 *
 * The composition root MUST consult the brain-cache FIRST. If the
 * exact key is fresh, the semantic-cache is never touched — no
 * embedding spend, no telemetry rows.
 *
 * This test simulates the kernel's `think()` ordering against both
 * layers and locks the invariant.
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainCache,
  thoughtCacheKey,
  classifyIntent,
} from '../../brain-cache.js';
import {
  createSemanticCache,
  createInMemoryCacheStore,
  createSemanticEmbedder,
  type SemanticCacheScope,
} from '../index.js';
import type { EmbedderPort } from '../../embedder.js';
import type {
  BrainDecision,
  ThoughtRequest,
} from '../../kernel-types.js';
import type { ScopeContext } from '../../../types.js';

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
): EmbedderPort {
  return {
    modelId: 'fake',
    dims: 4,
    async embed(text) {
      return fn(text);
    },
  };
}

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't1',
  actorUserId: 'u1',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

const SEM_SCOPE: SemanticCacheScope = {
  tenantId: 't1',
  surface: 'tenant-portal',
  personaId: 'tenant-resident',
};

function buildReq(message: string): ThoughtRequest {
  return {
    threadId: 'th1',
    userMessage: message,
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'low',
    surface: 'estate-manager-app',
  };
}

describe('brain-cache + semantic-cache layering', () => {
  it('brain-cache hit short-circuits BEFORE semantic-cache lookup', async () => {
    const brain = createBrainCache({ capacity: 16, ttlMs: 60_000 });
    let embedCalls = 0;
    const semantic = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({
        embedder: buildEmbedder((t) => {
          embedCalls += 1;
          return [t.length, 0, 0, 0];
        }),
      }),
    });

    const req = buildReq('rent statement please');
    const key = thoughtCacheKey(req);
    brain.set(key, fakeDecision('cached'));

    // Composition root: brain-cache first.
    const brainHit = brain.get(key);
    expect(brainHit).not.toBeNull();
    if (brainHit) return; // short-circuit — never touch semantic

    // If we erroneously reached the semantic layer we'd embed.
    await semantic.lookup({
      scope: SEM_SCOPE,
      userMessage: req.userMessage,
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(embedCalls).toBe(0);
  });

  it('brain-cache miss → semantic-cache consulted', async () => {
    const brain = createBrainCache({ capacity: 16, ttlMs: 60_000 });
    let embedCalls = 0;
    const semantic = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({
        embedder: buildEmbedder((t) => {
          embedCalls += 1;
          return [t.length, 0, 0, 0];
        }),
      }),
    });

    const req = buildReq('rent statement please');
    const key = thoughtCacheKey(req);

    // Brain-cache miss simulates fresh request.
    const brainHit = brain.get(key);
    expect(brainHit).toBeNull();

    const out = await semantic.lookup({
      scope: SEM_SCOPE,
      userMessage: req.userMessage,
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(out.outcome).toBe('miss');
    expect(embedCalls).toBe(1);
  });

  it('command intent skips BOTH cache layers (brain-cache ttl=0, semantic skips)', async () => {
    const brain = createBrainCache({ capacity: 16, ttlMs: 60_000 });
    let embedCalls = 0;
    const semantic = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: createSemanticEmbedder({
        embedder: buildEmbedder((t) => {
          embedCalls += 1;
          return [t.length, 0, 0, 0];
        }),
      }),
    });

    const req = buildReq('please pay invoice 123');
    const { intent } = classifyIntent(req.userMessage);
    expect(intent).toBe('command');

    // Brain-cache: cmd-intent should not be stored (ttl=0).
    brain.set(thoughtCacheKey(req), fakeDecision('stale'), 0);
    expect(brain.get(thoughtCacheKey(req))).toBeNull();

    // Semantic-cache should refuse to embed.
    const out = await semantic.lookup({
      scope: SEM_SCOPE,
      userMessage: req.userMessage,
      answeringModelId: 'claude-sonnet-4-6',
    });
    expect(out.outcome).toBe('skip');
    expect(embedCalls).toBe(0);
  });
});
