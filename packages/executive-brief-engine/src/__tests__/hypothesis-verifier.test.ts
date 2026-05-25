import { describe, expect, it } from 'vitest';
import { verifyHypotheses } from '../hypothesis-verifier.js';
import type { OnlineJudgePort, ToTLatsPort } from '../hypothesis-verifier.js';
import type { HybridRetrieverDeps, RetrievalHit } from '../retrieval.js';
import type { Hypothesis } from '../types.js';
import type { GraphTraversalPort } from '@borjie/org-graph';

const NOW = new Date('2026-05-22T06:00:00.000Z');
void NOW;

function hyp(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    kind: 'risk',
    title: 'Test',
    description: 'Desc',
    severity: 'HIGH',
    evidenceRefs: [{ kind: 'entity', id: 'ent_1' }],
    ...overrides,
  };
}

function makeRetrievalDeps(initialEvidence: RetrievalHit[]): HybridRetrieverDeps {
  return {
    bm25: { async search() { return initialEvidence; } },
    vector: { async search() { return []; } },
    embedder: { async embed() { return [0.1]; } },
    mmr: { async rerank({ hits, k }) { return hits.slice(0, k); } },
    graph: {
      async findAncestors() { return []; },
      async findDescendants() { return []; },
      async findShortestPath() { return null; },
      async findAllReachable() { return []; },
    } as GraphTraversalPort,
  };
}

const ALWAYS_HIGH_JUDGE: OnlineJudgePort = {
  async score() { return 0.9; },
};
const ALWAYS_LOW_JUDGE: OnlineJudgePort = {
  async score() { return 0.1; },
};

const SURVIVES_TOTLATS: ToTLatsPort = {
  async verify() {
    return { survives: true, additionalEvidence: [] };
  },
};

const DROPS_TOTLATS: ToTLatsPort = {
  async verify() {
    return { survives: false, additionalEvidence: [] };
  },
};

describe('verifyHypotheses', () => {
  const evidenceHit: RetrievalHit = {
    id: 'ent_1',
    kind: 'entity',
    snippet: 'evidence',
    score: 0.9,
    source: 'bm25',
  };

  it('survives a hypothesis with high judge score + retrieval evidence', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([evidenceHit]),
        judge: ALWAYS_HIGH_JUDGE,
        totLats: SURVIVES_TOTLATS,
      },
      { tenantId: 't', hypotheses: [hyp()] },
    );
    expect(r.survivors).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it('rejects when judge score is below threshold', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([evidenceHit]),
        judge: ALWAYS_LOW_JUDGE,
        totLats: SURVIVES_TOTLATS,
      },
      { tenantId: 't', hypotheses: [hyp()] },
    );
    expect(r.survivors).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('rejects when ToT/LATS drops the hypothesis', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([evidenceHit]),
        judge: ALWAYS_HIGH_JUDGE,
        totLats: DROPS_TOTLATS,
      },
      { tenantId: 't', hypotheses: [hyp()] },
    );
    expect(r.survivors).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('rejects uncited hypotheses even if ToT/LATS says survives', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([]), // no evidence
        judge: ALWAYS_HIGH_JUDGE,
        totLats: SURVIVES_TOTLATS,
      },
      {
        tenantId: 't',
        hypotheses: [hyp({ evidenceRefs: [] })],
      },
    );
    expect(r.survivors).toHaveLength(0);
  });

  it('respects topN slice', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([evidenceHit]),
        judge: ALWAYS_HIGH_JUDGE,
        totLats: SURVIVES_TOTLATS,
      },
      {
        tenantId: 't',
        hypotheses: [hyp(), hyp({ title: 'Two' }), hyp({ title: 'Three' })],
        topN: 1,
      },
    );
    expect(r.survivors).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
  });

  it('handles judge failure gracefully', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([evidenceHit]),
        judge: {
          async score() {
            throw new Error('judge down');
          },
        },
        totLats: SURVIVES_TOTLATS,
      },
      { tenantId: 't', hypotheses: [hyp()] },
    );
    // Score becomes 0 → rejected.
    expect(r.survivors).toHaveLength(0);
  });

  it('handles ToT/LATS failure gracefully', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([evidenceHit]),
        judge: ALWAYS_HIGH_JUDGE,
        totLats: {
          async verify() {
            throw new Error('lats down');
          },
        },
      },
      { tenantId: 't', hypotheses: [hyp()] },
    );
    expect(r.survivors).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('returns empty result on empty input', async () => {
    const r = await verifyHypotheses(
      {
        retrieval: makeRetrievalDeps([]),
        judge: ALWAYS_HIGH_JUDGE,
        totLats: SURVIVES_TOTLATS,
      },
      { tenantId: 't', hypotheses: [] },
    );
    expect(r.survivors).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });
});
