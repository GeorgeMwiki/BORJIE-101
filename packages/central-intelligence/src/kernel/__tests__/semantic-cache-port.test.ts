/**
 * Semantic-cache port — LP-03.
 *
 * Verifies read-through / write-through fail-safe semantics + scope
 * isolation, decoupled from the concrete embedding cache.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSemanticScope,
  semanticCacheRead,
  semanticCacheWrite,
  type SemanticCachePort,
  type SemanticCacheLookupResultLike,
  type SemanticScope,
} from '../semantic-cache-port.js';
import type { BrainDecision } from '../kernel-types.js';

function answerDecision(text: string): BrainDecision {
  return {
    kind: 'answer',
    text,
    citations: [],
    artifacts: [],
    confidence: { overall: 0.9, components: {} } as never,
    gates: {} as never,
    provenance: {} as never,
  };
}

function refusalDecision(): BrainDecision {
  return {
    kind: 'refusal',
    reason: 'no',
    gateThatRefused: 'policy',
    provenance: {} as never,
  };
}

const SCOPE: SemanticScope = {
  tenantId: 'tenant-1',
  surface: 'owner-portal',
  personaId: 'mr-mwikila',
};

/** Build a port that returns a fixed lookup result + records store calls. */
function makePort(
  lookupResult: SemanticCacheLookupResultLike,
  stored: Array<{ scope: SemanticScope; value: BrainDecision }>,
): SemanticCachePort {
  return {
    lookup: async () => lookupResult,
    store: async (args) => {
      stored.push({ scope: args.scope, value: args.value });
    },
  };
}

describe('LP-03 — buildSemanticScope', () => {
  it('preserves tenant/surface/persona and fills safe defaults', () => {
    const s = buildSemanticScope({ tenantId: 't', surface: undefined, personaId: undefined });
    expect(s.tenantId).toBe('t');
    expect(s.surface).toBe('unknown-surface');
    expect(s.personaId).toBe('mr-mwikila');
  });

  it('keeps null tenant for platform scopes', () => {
    const s = buildSemanticScope({ tenantId: null, surface: 'marketing', personaId: 'p' });
    expect(s.tenantId).toBeNull();
  });
});

describe('LP-03 — read-through', () => {
  it('returns null when disabled', async () => {
    const r = await semanticCacheRead({
      cache: makePort({ outcome: 'miss', embedding: [1, 2] }, []),
      enabled: false,
      scope: SCOPE,
      userMessage: 'q',
      answeringModelId: 'm',
    });
    expect(r.hit).toBeNull();
    expect(r.missEmbedding).toBeNull();
  });

  it('returns the cached decision on a hit', async () => {
    const r = await semanticCacheRead({
      cache: makePort(
        { outcome: 'hit', value: answerDecision('cached'), similarity: 0.97, cacheId: 'x' },
        [],
      ),
      enabled: true,
      scope: SCOPE,
      userMessage: 'what is the royalty',
      answeringModelId: 'm',
    });
    expect(r.hit?.kind).toBe('answer');
    expect(r.similarity).toBe(0.97);
  });

  it('carries the miss embedding for write re-use', async () => {
    const r = await semanticCacheRead({
      cache: makePort({ outcome: 'miss', embedding: [0.1, 0.2, 0.3] }, []),
      enabled: true,
      scope: SCOPE,
      userMessage: 'q',
      answeringModelId: 'm',
    });
    expect(r.hit).toBeNull();
    expect(r.missEmbedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('treats skip as a no-embedding miss', async () => {
    const r = await semanticCacheRead({
      cache: makePort({ outcome: 'skip', reason: 'uncacheable intent' }, []),
      enabled: true,
      scope: SCOPE,
      userMessage: 'q',
      answeringModelId: 'm',
    });
    expect(r.hit).toBeNull();
    expect(r.missEmbedding).toBeNull();
  });

  it('fail-safes to a miss when lookup throws', async () => {
    const exploding: SemanticCachePort = {
      lookup: async () => {
        throw new Error('redis down');
      },
      store: async () => undefined,
    };
    const r = await semanticCacheRead({
      cache: exploding,
      enabled: true,
      scope: SCOPE,
      userMessage: 'q',
      answeringModelId: 'm',
    });
    expect(r.hit).toBeNull();
  });

  it('skips empty user messages', async () => {
    const r = await semanticCacheRead({
      cache: makePort({ outcome: 'miss', embedding: [1] }, []),
      enabled: true,
      scope: SCOPE,
      userMessage: '   ',
      answeringModelId: 'm',
    });
    expect(r.missEmbedding).toBeNull();
  });
});

describe('LP-03 — write-through', () => {
  it('persists an answer decision under the scope using the miss embedding', async () => {
    const stored: Array<{ scope: SemanticScope; value: BrainDecision }> = [];
    await semanticCacheWrite({
      cache: makePort({ outcome: 'skip', reason: 'n/a' }, stored),
      enabled: true,
      scope: SCOPE,
      userMessage: 'q',
      decision: answerDecision('fresh'),
      missEmbedding: [0.5, 0.5],
      cacheId: 'thought-1',
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.scope.tenantId).toBe('tenant-1');
  });

  it('does NOT cache refusals', async () => {
    const stored: Array<{ scope: SemanticScope; value: BrainDecision }> = [];
    await semanticCacheWrite({
      cache: makePort({ outcome: 'skip', reason: 'n/a' }, stored),
      enabled: true,
      scope: SCOPE,
      userMessage: 'q',
      decision: refusalDecision(),
      missEmbedding: [0.5],
      cacheId: 'thought-1',
    });
    expect(stored).toHaveLength(0);
  });

  it('skips when there is no miss embedding', async () => {
    const stored: Array<{ scope: SemanticScope; value: BrainDecision }> = [];
    await semanticCacheWrite({
      cache: makePort({ outcome: 'skip', reason: 'n/a' }, stored),
      enabled: true,
      scope: SCOPE,
      userMessage: 'q',
      decision: answerDecision('fresh'),
      missEmbedding: null,
      cacheId: 'thought-1',
    });
    expect(stored).toHaveLength(0);
  });

  it('never throws when store fails', async () => {
    const exploding: SemanticCachePort = {
      lookup: async () => ({ outcome: 'skip', reason: 'n/a' }),
      store: async () => {
        throw new Error('store down');
      },
    };
    await expect(
      semanticCacheWrite({
        cache: exploding,
        enabled: true,
        scope: SCOPE,
        userMessage: 'q',
        decision: answerDecision('fresh'),
        missEmbedding: [1],
        cacheId: 't',
      }),
    ).resolves.toBeUndefined();
  });
});
