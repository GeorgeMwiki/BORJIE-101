/**
 * Orchestrator-path semantic-cache lighting — latency win 1.
 *
 * Verifies: per-tenant isolation (MANDATORY), per-locale isolation
 * (EN/SW absolute), evidence-required write gating, cache-hit marker,
 * and fail-safe behaviour. Exercised end-to-end against the REAL
 * in-memory semantic cache so the scope-key isolation is proven, not
 * mocked away.
 */

import { describe, it, expect } from 'vitest';
import {
  buildOrchestratorScope,
  readOrchestratorSemanticCache,
  writeOrchestratorSemanticCache,
  isEvidenceBackedAnswer,
  markCacheHit,
  resolveTurnLocale,
} from '../orchestrator-fast-cache.js';
import { createSemanticCache } from '../semantic-cache/semantic-cache.js';
import {
  createInMemoryCacheStore,
  type SemanticCacheScope,
} from '../semantic-cache/cache-store.js';
import type { SemanticEmbedder } from '../semantic-cache/embedder.js';
import type { SemanticCachePort } from '../semantic-cache-port.js';
import type { BrainDecision, ThoughtRequest } from '../kernel-types.js';

// ── Test doubles ─────────────────────────────────────────────────────

/**
 * Deterministic embedder: embeds the user message into a unit-ish vector
 * derived from its char codes so identical text ⇒ identical vector (a
 * guaranteed cosine=1 self-hit) and different text ⇒ different vector.
 * Crucially it IGNORES scope, so if any cross-tenant hit occurred it would
 * be a real scope-key leak — not masked by a scope-aware embedding.
 */
function deterministicEmbedder(): SemanticEmbedder {
  const dims = 8;
  return {
    modelId: 'test-embedder',
    dims,
    async embedForCache(_scope, prompt) {
      const v = new Array(dims).fill(0);
      for (let i = 0; i < prompt.length; i += 1) {
        v[i % dims] += prompt.charCodeAt(i);
      }
      return v;
    },
    clearCache() {},
  };
}

function makeCache(): SemanticCachePort {
  return createSemanticCache({
    store: createInMemoryCacheStore(),
    embedder: deterministicEmbedder(),
    defaultThreshold: 0.999,
  });
}

function answer(text: string, citations: ReadonlyArray<unknown> = [{ id: 'ev-1' }]): BrainDecision {
  return {
    kind: 'answer',
    text,
    citations: citations as never,
    artifacts: [],
    confidence: {
      groundedness: 1,
      stability: 1,
      review: 1,
      numericalConsistency: 1,
      overall: 1,
    },
    gates: {
      inviolable: { status: 'pass' },
      policy: { status: 'pass' },
      drift: { status: 'pass' },
      cognitiveLoad: { status: 'pass' },
    },
    provenance: {
      thoughtId: 't',
      threadId: 'th',
      scopeKind: 'tenant',
      tier: 'tenant',
      stakes: 'low',
      inputHash: 'i',
      outputHash: 'o',
      toolCallSummaries: [],
      sensorId: 's',
      modelId: 'm',
      cacheHit: false,
      judgeScore: null,
      cohortFingerprints: [],
      producedAt: new Date().toISOString(),
      latencyMs: 1,
    },
  } as BrainDecision;
}

function req(args: {
  tenantId: string;
  message: string;
  language?: 'en' | 'sw';
  surface?: ThoughtRequest['surface'];
}): ThoughtRequest {
  return {
    threadId: 'thread-1',
    userMessage: args.message,
    scope: {
      kind: 'tenant',
      tenantId: args.tenantId,
      actorUserId: 'user-1',
      roles: ['owner'],
      personaId: 'mr-mwikila',
    },
    tier: 'tenant',
    stakes: 'low',
    surface: args.surface ?? 'owner-portal',
    ...(args.language ? { language: args.language } : {}),
  } as ThoughtRequest;
}

async function seed(
  cache: SemanticCachePort,
  r: ThoughtRequest,
  decision: BrainDecision,
): Promise<void> {
  const scope = buildOrchestratorScope(r);
  const read = await readOrchestratorSemanticCache({
    cache,
    enabled: true,
    req: r,
    scope,
    answeringModelId: 'm',
  });
  expect(read.hit).toBeNull();
  await writeOrchestratorSemanticCache({
    cache,
    enabled: true,
    req: r,
    scope,
    decision,
    missEmbedding: read.missEmbedding,
    cacheId: 'cache-1',
  });
}

// ── MANDATORY: per-tenant cache isolation ────────────────────────────

describe('orchestrator semantic cache — per-tenant isolation (SECURITY)', () => {
  it('NEVER returns tenant A entry to tenant B for the identical prompt', async () => {
    const cache = makeCache();
    const message = 'what is the royalty rate for gold';
    const tenantA = req({ tenantId: 'tenant-A', message });
    const tenantB = req({ tenantId: 'tenant-B', message });

    await seed(cache, tenantA, answer('A-secret-royalty-answer'));

    // Tenant B asks the BYTE-IDENTICAL question.
    const bRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: tenantB,
      scope: buildOrchestratorScope(tenantB),
      answeringModelId: 'm',
    });
    expect(bRead.hit).toBeNull(); // hard isolation — no cross-tenant hit

    // Tenant A still hits its own entry.
    const aRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: tenantA,
      scope: buildOrchestratorScope(tenantA),
      answeringModelId: 'm',
    });
    expect(aRead.hit?.kind).toBe('answer');
    expect((aRead.hit as { text: string }).text).toBe('A-secret-royalty-answer');
  });

  it('tenant B never hits tenant A entry even on the FUZZY (near-miss) cosine path', async () => {
    // A near-paraphrase (not byte-identical) so the match relies on the
    // cosine-similarity lane, not the exact-string lane. Cross-tenant
    // isolation must still hold — the scope partitions the embedding space.
    const cache = createSemanticCache({
      store: createInMemoryCacheStore(),
      embedder: deterministicEmbedder(),
      // Loosen the threshold so a paraphrase WOULD hit within a scope —
      // proving the block below is scope-driven, not threshold-driven.
      defaultThreshold: 0.5,
    });
    const aSeedText = 'what is the royalty rate for gold ore';
    const aSeed = req({ tenantId: 'tenant-A', message: aSeedText });
    await seed(cache, aSeed, answer('A-only-royalty'));

    // Same tenant, a near-paraphrase ⇒ fuzzy hit confirms the lane works.
    const aFuzzy = req({
      tenantId: 'tenant-A',
      message: 'what is the royalty rate for gold ores',
    });
    const aFuzzyRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: aFuzzy,
      scope: buildOrchestratorScope(aFuzzy),
      answeringModelId: 'm',
    });
    expect(aFuzzyRead.hit?.kind).toBe('answer'); // fuzzy lane is live

    // Tenant B with the SAME near-paraphrase ⇒ still a hard miss.
    const bFuzzy = req({
      tenantId: 'tenant-B',
      message: 'what is the royalty rate for gold ores',
    });
    const bFuzzyRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: bFuzzy,
      scope: buildOrchestratorScope(bFuzzy),
      answeringModelId: 'm',
    });
    expect(bFuzzyRead.hit).toBeNull(); // no cross-tenant leak on fuzzy path
  });

  it('platform-scope (null tenant) never collides with a real tenant', async () => {
    const cache = makeCache();
    const message = 'tell me about borjie';
    const platform = req({ tenantId: 'tenant-A', message });
    // Force a platform scope (null tenant) by constructing the request scope.
    const platformReq = {
      ...platform,
      scope: { ...platform.scope, kind: 'platform' },
    } as unknown as ThoughtRequest;

    await seed(cache, req({ tenantId: 'tenant-A', message }), answer('tenant-answer'));
    const read = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: platformReq,
      scope: buildOrchestratorScope(platformReq),
      answeringModelId: 'm',
    });
    expect(read.hit).toBeNull();
  });
});

// ── EN/SW absolute: per-locale isolation ─────────────────────────────

describe('orchestrator semantic cache — per-locale isolation (EN/SW)', () => {
  it('an EN turn NEVER replays a cached SW answer for the same tenant+prompt', async () => {
    const cache = makeCache();
    const message = 'habari';
    const swTurn = req({ tenantId: 'tenant-A', message, language: 'sw' });
    const enTurn = req({ tenantId: 'tenant-A', message, language: 'en' });

    await seed(cache, swTurn, answer('Karibu! Jibu la Kiswahili.'));

    const enRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: enTurn,
      scope: buildOrchestratorScope(enTurn),
      answeringModelId: 'm',
    });
    expect(enRead.hit).toBeNull(); // no cross-locale leak

    const swRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: swTurn,
      scope: buildOrchestratorScope(swTurn),
      answeringModelId: 'm',
    });
    expect(swRead.hit?.kind).toBe('answer');
  });

  it('resolveTurnLocale defaults to en and honours sw', () => {
    expect(resolveTurnLocale(req({ tenantId: 't', message: 'x' }))).toBe('en');
    expect(
      resolveTurnLocale(req({ tenantId: 't', message: 'x', language: 'sw' })),
    ).toBe('sw');
  });
});

// ── Evidence-required write gating ───────────────────────────────────

describe('orchestrator semantic cache — evidence-required write gating', () => {
  it('caches an evidence-backed answer and replays it with cacheHit marker', async () => {
    const cache = makeCache();
    const r = req({ tenantId: 'tenant-A', message: 'what is the offtake premium' });
    await seed(cache, r, answer('grounded', [{ id: 'ev-1' }]));
    const read = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: r,
      scope: buildOrchestratorScope(r),
      answeringModelId: 'm',
    });
    expect(read.hit?.kind).toBe('answer');
    expect(read.hit?.provenance.cacheHit).toBe(true); // marker stamped
  });

  it('does NOT cache an evidence-EMPTY answer', async () => {
    const cache = makeCache();
    const r = req({ tenantId: 'tenant-A', message: 'ungrounded question' });
    const scope = buildOrchestratorScope(r);
    const read = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: r,
      scope,
      answeringModelId: 'm',
    });
    await writeOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: r,
      scope,
      decision: answer('no-evidence', []), // empty citation chain
      missEmbedding: read.missEmbedding,
      cacheId: 'c',
    });
    const reRead = await readOrchestratorSemanticCache({
      cache,
      enabled: true,
      req: r,
      scope,
      answeringModelId: 'm',
    });
    expect(reRead.hit).toBeNull(); // ungrounded answer never cached
  });

  it('isEvidenceBackedAnswer rejects refusals + empty-citation answers', () => {
    expect(isEvidenceBackedAnswer(answer('a', [{ id: '1' }]))).toBe(true);
    expect(isEvidenceBackedAnswer(answer('a', []))).toBe(false);
    expect(
      isEvidenceBackedAnswer({
        kind: 'refusal',
        reason: 'no',
        gateThatRefused: 'policy',
        provenance: answer('x').provenance,
      } as BrainDecision),
    ).toBe(false);
  });
});

// ── Fail-safe ────────────────────────────────────────────────────────

describe('orchestrator semantic cache — fail-safe', () => {
  it('disabled / unwired ⇒ miss, no throw', async () => {
    const r = req({ tenantId: 'tenant-A', message: 'x' });
    const read = await readOrchestratorSemanticCache({
      cache: undefined,
      enabled: false,
      req: r,
      scope: buildOrchestratorScope(r),
      answeringModelId: 'm',
    });
    expect(read.hit).toBeNull();
    expect(read.missEmbedding).toBeNull();
  });

  it('lookup fault ⇒ miss (never throws)', async () => {
    const exploding: SemanticCachePort = {
      lookup: async () => {
        throw new Error('redis down');
      },
      store: async () => undefined,
    };
    const r = req({ tenantId: 'tenant-A', message: 'x' });
    const read = await readOrchestratorSemanticCache({
      cache: exploding,
      enabled: true,
      req: r,
      scope: buildOrchestratorScope(r),
      answeringModelId: 'm',
    });
    expect(read.hit).toBeNull();
  });

  it('markCacheHit is immutable (does not mutate the cached entry)', () => {
    const original = answer('x');
    expect(original.provenance.cacheHit).toBe(false);
    const marked = markCacheHit(original);
    expect(marked.provenance.cacheHit).toBe(true);
    expect(original.provenance.cacheHit).toBe(false); // untouched
  });

  it('buildOrchestratorScope yields the same scope shape the store keys on', () => {
    const r = req({ tenantId: 'tenant-A', message: 'x', language: 'sw' });
    const scope: SemanticCacheScope = buildOrchestratorScope(r);
    expect(scope.tenantId).toBe('tenant-A');
    expect(scope.locale).toBe('sw');
    expect(scope.surface).toBe('owner-portal');
    expect(scope.personaId).toBe('mr-mwikila');
  });
});
