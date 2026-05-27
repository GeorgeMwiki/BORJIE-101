import { describe, expect, it } from 'vitest';
import { createColdstartRouter } from '../coldstart/coldstart-strategy.js';
import { createContentBasedRecommender } from '../algorithms/content-based.js';
import { createItemItemCFRecommender } from '../algorithms/item-item-cf.js';
import { createPopularityRecommender } from '../algorithms/popularity.js';
import { buildClusterCorpus, buildRequest } from '../__fixtures__/synthetic.js';

describe('cold-start router', () => {
  it('routes a 0-interaction user with embeddings to content-based', () => {
    const corpus = buildClusterCorpus();
    const router = createColdstartRouter({
      popularity: createPopularityRecommender(),
      content: createContentBasedRecommender(),
      cf: createItemItemCFRecommender(),
      contentBasedThreshold: 3,
      cfThreshold: 1,
    });
    // u4 has no interactions but embeddings exist on candidates and we
    // supply a user embedding — router should pick content_based.
    const baseReq = buildRequest({ corpus, userId: 'u4', topK: 3 });
    const decision = router.decide({
      ...baseReq,
      user: {
        tenantId: corpus.tenantId,
        id: 'u4',
        embedding: { tenantId: corpus.tenantId, id: 'u4', values: [1, 0] },
      },
    });
    expect(decision).toBe('content_based');
  });

  it('routes a many-interaction user to CF', () => {
    const corpus = buildClusterCorpus();
    const router = createColdstartRouter({
      popularity: createPopularityRecommender(),
      content: createContentBasedRecommender(),
      cf: createItemItemCFRecommender(),
      contentBasedThreshold: 3,
      cfThreshold: 1,
    });
    // u0 has 3 positive interactions — beyond the content-based threshold.
    const req = buildRequest({ corpus, userId: 'u0', topK: 3 });
    expect(router.decide(req)).toBe('cf');
  });

  it('falls back to popularity when no embeddings are available', () => {
    const corpus = buildClusterCorpus();
    const router = createColdstartRouter({
      popularity: createPopularityRecommender(),
      content: createContentBasedRecommender(),
      cf: createItemItemCFRecommender(),
      contentBasedThreshold: 3,
      cfThreshold: 1,
    });
    // Strip embeddings to force popularity floor for cold user.
    const baseReq = buildRequest({ corpus, userId: 'u4', topK: 3 });
    const stripped = baseReq.candidates.map((c) => ({
      tenantId: c.tenantId,
      id: c.id,
    }));
    expect(router.decide({ ...baseReq, candidates: stripped })).toBe(
      'popularity',
    );
  });

  it('rejects cfThreshold > contentBasedThreshold', () => {
    expect(() =>
      createColdstartRouter({
        popularity: createPopularityRecommender(),
        content: createContentBasedRecommender(),
        cf: createItemItemCFRecommender(),
        cfThreshold: 5,
        contentBasedThreshold: 3,
      }),
    ).toThrow(/cfThreshold .* must be <=/);
  });
});
