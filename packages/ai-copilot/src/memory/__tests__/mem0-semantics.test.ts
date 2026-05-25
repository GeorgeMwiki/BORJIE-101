/**
 * mem0-semantics — unit tests.
 *
 * Coverage:
 *   1. ADD when the fact-type bucket is empty
 *   2. ADD when best match falls below contradictionThreshold
 *   3. UPDATE when the candidate refines an existing fact
 *   4. UPDATE when the candidate brings higher confidence on the same claim
 *   5. NOOP when the candidate is a duplicate with equal-or-lower confidence
 *   6. DELETE when negation matches an existing fact
 *   7. DELETE via explicitNegation flag (no keyword)
 *   8. ADD when negation has no prior fact above deleteThreshold
 *   9. Embedding-pair similarity used when both sides carry vectors
 *  10. Jaccard fallback when embeddings missing / mismatched dims
 *  11. describeMem0Decision returns a human-readable label for every kind
 *  12. withEmbedding helper resolves the embedder and returns a new object
 *  13. withEmbedding swallows embedder failures (returns original candidate)
 *  14. Custom thresholds are honoured
 *  15. Cross-factType existing facts are ignored
 */

import { describe, it, expect, vi } from 'vitest';
import {
  decideMem0Op,
  describeMem0Decision,
  jaccardSimilarity,
  cosineSimilarity,
  withEmbedding,
  DEFAULT_CONTRADICTION_THRESHOLD,
  DEFAULT_DELETE_THRESHOLD,
  DEFAULT_NOOP_THRESHOLD,
  type Mem0Candidate,
  type Mem0Embedder,
  type Mem0ExistingFact,
} from '../mem0-semantics.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fact(
  id: string,
  text: string,
  overrides: Partial<Mem0ExistingFact> = {},
): Mem0ExistingFact {
  return {
    id,
    factText: text,
    factType: overrides.factType ?? 'preference',
    confidence: overrides.confidence ?? 0.8,
    ...(overrides.embedding ? { embedding: overrides.embedding } : {}),
  };
}

function cand(
  text: string,
  overrides: Partial<Mem0Candidate> = {},
): Mem0Candidate {
  const base: Mem0Candidate = {
    factText: text,
    factType: overrides.factType ?? 'preference',
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// 1. ADD when bucket is empty
// ---------------------------------------------------------------------------

describe('decideMem0Op — ADD', () => {
  it('returns ADD when no existing facts share the factType', () => {
    const decision = decideMem0Op(cand('tenant prefers SMS reminders'), []);
    expect(decision.kind).toBe('add');
    if (decision.kind === 'add') {
      expect(decision.reason).toMatch(/no existing fact/i);
    }
  });

  it('returns ADD when the best match falls below contradictionThreshold', () => {
    const existing = [fact('f1', 'tenant likes blue paint')];
    const decision = decideMem0Op(cand('asha rents unit 4B'), existing);
    expect(decision.kind).toBe('add');
    if (decision.kind === 'add') {
      expect(decision.reason).toMatch(/< 0.85/);
    }
  });

  it('ignores facts of a different factType', () => {
    const existing = [
      fact('f1', 'asha rents unit 4B', { factType: 'business' }),
    ];
    const decision = decideMem0Op(
      cand('asha rents unit 4B', { factType: 'preference' }),
      existing,
    );
    expect(decision.kind).toBe('add');
  });
});

// ---------------------------------------------------------------------------
// 2. UPDATE
// ---------------------------------------------------------------------------

describe('decideMem0Op — UPDATE', () => {
  it('returns UPDATE when the candidate contradicts a prior fact', () => {
    // High overlap so similarity passes contradictionThreshold but
    // carriesSameClaim is false (different month tokens). Without
    // embeddings the Jaccard score on long sentences is below the
    // default 0.85 — so use embeddings to push the similarity above
    // the threshold while keeping the text difference that defeats
    // carriesSameClaim.
    const existing = [
      fact('f1', 'tenant pays rent on the first of march via bank transfer', {
        embedding: [1, 0, 0],
      }),
    ];
    const decision = decideMem0Op(
      cand('tenant pays rent on the first of april via bank transfer', {
        embedding: [0.99, 0.05, 0.05],
      }),
      existing,
    );
    expect(decision.kind).toBe('update');
    if (decision.kind === 'update') {
      expect(decision.supersedesId).toBe('f1');
      expect(decision.similarity).toBeGreaterThanOrEqual(
        DEFAULT_CONTRADICTION_THRESHOLD,
      );
    }
  });

  it('returns UPDATE when same claim arrives with higher confidence', () => {
    const existing = [
      fact('f1', 'tenant prefers swahili language', { confidence: 0.5 }),
    ];
    const decision = decideMem0Op(
      cand('tenant prefers swahili language', { confidence: 0.95 }),
      existing,
    );
    expect(decision.kind).toBe('update');
    if (decision.kind === 'update') {
      expect(decision.supersedesId).toBe('f1');
      expect(decision.reason).toMatch(/higher confidence/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. NOOP
// ---------------------------------------------------------------------------

describe('decideMem0Op — NOOP', () => {
  it('returns NOOP for a duplicate with equal-or-lower confidence', () => {
    const existing = [
      fact('f1', 'tenant prefers swahili language', { confidence: 0.9 }),
    ];
    const decision = decideMem0Op(
      cand('tenant prefers swahili language', { confidence: 0.8 }),
      existing,
    );
    expect(decision.kind).toBe('noop');
    if (decision.kind === 'noop') {
      expect(decision.matchedId).toBe('f1');
      expect(decision.similarity).toBeGreaterThanOrEqual(
        DEFAULT_NOOP_THRESHOLD,
      );
    }
  });

  it('returns NOOP at equal confidence (≤ check)', () => {
    const existing = [
      fact('f1', 'tenant prefers swahili language', { confidence: 0.85 }),
    ];
    const decision = decideMem0Op(
      cand('tenant prefers swahili language', { confidence: 0.85 }),
      existing,
    );
    expect(decision.kind).toBe('noop');
  });
});

// ---------------------------------------------------------------------------
// 4. DELETE — negation
// ---------------------------------------------------------------------------

describe('decideMem0Op — DELETE via negation', () => {
  it('returns DELETE when a keyword negation matches a prior fact', () => {
    const existing = [fact('f1', 'asha rents unit 4B')];
    const decision = decideMem0Op(
      cand('asha no longer rents unit 4B'),
      existing,
    );
    expect(decision.kind).toBe('delete');
    if (decision.kind === 'delete') {
      expect(decision.targetId).toBe('f1');
      expect(decision.similarity).toBeGreaterThanOrEqual(
        DEFAULT_DELETE_THRESHOLD,
      );
    }
  });

  it('honours the explicitNegation flag even without a keyword', () => {
    const existing = [fact('f1', 'asha rents unit 4B')];
    const decision = decideMem0Op(
      cand('asha rents unit 4B', { explicitNegation: true }),
      existing,
    );
    expect(decision.kind).toBe('delete');
  });

  it('returns ADD when negation has no prior fact above deleteThreshold', () => {
    const existing = [
      fact('f1', 'tenant likes blue paint in lobby skirting boards'),
    ];
    const decision = decideMem0Op(
      cand('asha no longer rents unit 4B'),
      existing,
    );
    expect(decision.kind).toBe('add');
    if (decision.kind === 'add') {
      expect(decision.reason).toMatch(/negation/);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Similarity pairing — embeddings vs Jaccard
// ---------------------------------------------------------------------------

describe('pair similarity', () => {
  it('uses cosine similarity when both sides carry equal-length embeddings', () => {
    // Two clearly-orthogonal embeddings → cosine ≈ 0 → ADD, not
    // NOOP, even though the texts are identical. Proves embeddings
    // are taking the priority path over Jaccard.
    const existing = [
      fact('f1', 'duplicate text', {
        embedding: [1, 0, 0, 0],
      }),
    ];
    const decision = decideMem0Op(
      cand('duplicate text', { embedding: [0, 0, 0, 1] }),
      existing,
    );
    expect(decision.kind).toBe('add');
  });

  it('falls back to Jaccard when only one side carries an embedding', () => {
    const existing = [
      fact('f1', 'tenant prefers swahili language', { confidence: 0.95 }),
    ];
    const decision = decideMem0Op(
      cand('tenant prefers swahili language', {
        embedding: [0.5, 0.5, 0.5, 0.5],
        confidence: 0.8,
      }),
      existing,
    );
    expect(decision.kind).toBe('noop');
  });

  it('falls back to Jaccard when embedding dimensions mismatch', () => {
    const existing = [
      fact('f1', 'tenant prefers swahili language', {
        embedding: [0.5, 0.5, 0.5],
        confidence: 0.95,
      }),
    ];
    const decision = decideMem0Op(
      cand('tenant prefers swahili language', {
        embedding: [0.5, 0.5, 0.5, 0.5],
        confidence: 0.8,
      }),
      existing,
    );
    expect(decision.kind).toBe('noop');
  });

  it('jaccardSimilarity returns 0 for two empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(0);
  });

  it('cosineSimilarity returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('cosineSimilarity returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Custom thresholds + describe helper + withEmbedding
// ---------------------------------------------------------------------------

describe('options + helpers', () => {
  it('honours custom thresholds', () => {
    const existing = [fact('f1', 'tenant prefers email')];
    // Default contradictionThreshold (0.85) would yield ADD for this
    // weak Jaccard match; with a permissive 0.1 threshold we expect
    // an UPDATE.
    const decision = decideMem0Op(cand('tenant prefers sms'), existing, {
      contradictionThreshold: 0.1,
    });
    expect(decision.kind).toBe('update');
  });

  it('describeMem0Decision produces a label for every kind', () => {
    expect(describeMem0Decision({ kind: 'add', reason: 'r' })).toMatch(/^ADD:/);
    expect(
      describeMem0Decision({
        kind: 'update',
        supersedesId: 'a',
        similarity: 0.9,
        reason: 'r',
      }),
    ).toMatch(/^UPDATE supersedes=a/);
    expect(
      describeMem0Decision({
        kind: 'delete',
        targetId: 'b',
        similarity: 0.8,
        reason: 'r',
      }),
    ).toMatch(/^DELETE target=b/);
    expect(
      describeMem0Decision({
        kind: 'noop',
        matchedId: 'c',
        similarity: 0.95,
        reason: 'r',
      }),
    ).toMatch(/^NOOP matched=c/);
  });

  it('withEmbedding resolves the embedder and returns a new object', async () => {
    const embedder: Mem0Embedder = vi.fn(async () => [0.1, 0.2, 0.3]);
    const before = cand('foo');
    const after = await withEmbedding(before, embedder);
    expect(embedder).toHaveBeenCalledOnce();
    expect(after).not.toBe(before);
    expect(after.embedding).toEqual([0.1, 0.2, 0.3]);
    // Immutability check — the original candidate is unchanged.
    expect(before.embedding).toBeUndefined();
  });

  it('withEmbedding skips the embedder when an embedding is already present', async () => {
    const embedder: Mem0Embedder = vi.fn(async () => [9, 9, 9]);
    const before = cand('foo', { embedding: [1, 2, 3] });
    const after = await withEmbedding(before, embedder);
    expect(embedder).not.toHaveBeenCalled();
    expect(after).toBe(before);
  });

  it('withEmbedding swallows embedder failures', async () => {
    const embedder: Mem0Embedder = vi.fn(async () => {
      throw new Error('boom');
    });
    const before = cand('foo');
    const after = await withEmbedding(before, embedder);
    expect(after).toBe(before);
  });
});
