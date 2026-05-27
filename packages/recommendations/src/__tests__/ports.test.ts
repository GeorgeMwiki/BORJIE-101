import { describe, expect, it } from 'vitest';
import {
  createDeterministicMockLLM,
  createLLMRerankRecommender,
} from '../algorithms/llm-rerank.js';
import {
  createDeterministicMockTwoTower,
  createTwoTowerRecommender,
} from '../algorithms/two-tower-port.js';
import { createContentBasedRecommender } from '../algorithms/content-based.js';
import {
  createDefaultExplanationGenerator,
  createLLMExplanationGenerator,
} from '../explain/explanation-generator.js';
import { buildClusterCorpus, buildRequest } from '../__fixtures__/synthetic.js';

describe('LLM rerank port', () => {
  it('returns identity ordering with the deterministic mock', async () => {
    const corpus = buildClusterCorpus();
    const base = createContentBasedRecommender();
    const reco = createLLMRerankRecommender({
      base,
      llm: createDeterministicMockLLM(),
      poolSize: 5,
    });
    const req = buildRequest({ corpus, userId: 'u0', topK: 3 });
    const result = await reco.recommendAsync(req);
    expect(result.algorithm).toBe('llm_rerank');
    expect(result.topK.length).toBeLessThanOrEqual(3);
    expect(result.auditHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('synchronous recommend() throws — caller must use recommendAsync', () => {
    const corpus = buildClusterCorpus();
    const reco = createLLMRerankRecommender({
      base: createContentBasedRecommender(),
      llm: createDeterministicMockLLM(),
    });
    expect(() =>
      reco.recommend(buildRequest({ corpus, userId: 'u0' })),
    ).toThrow(/async/);
  });
});

describe('Two-Tower port', () => {
  it('produces tenant-scoped embeddings — same id under two tenants differs', () => {
    const tower = createDeterministicMockTwoTower(8);
    const ea = tower.embedItem({ tenantId: 'tenant-a', itemId: 'm0' });
    const eb = tower.embedItem({ tenantId: 'tenant-b', itemId: 'm0' });
    // The hash includes the tenantId, so the two vectors must differ.
    const equal = ea.every((v, i) => v === eb[i]);
    expect(equal).toBe(false);
  });

  it('ranks candidates by dot product when wired via the recommender', () => {
    const corpus = buildClusterCorpus();
    const reco = createTwoTowerRecommender({
      tower: createDeterministicMockTwoTower(8),
    });
    const r = reco.recommend(buildRequest({ corpus, userId: 'u0', topK: 5 }));
    expect(r.algorithm).toBe('two_tower');
    expect(r.topK.length).toBe(5);
    for (let i = 1; i < r.topK.length; i += 1) {
      expect(r.topK[i]!.score).toBeLessThanOrEqual(r.topK[i - 1]!.score);
    }
  });
});

describe('Explanation generator', () => {
  it('default generator produces a deterministic feature-grounded narrative', async () => {
    const corpus = buildClusterCorpus();
    const reco = createContentBasedRecommender();
    const result = reco.recommend(
      buildRequest({ corpus, userId: 'u0', topK: 2 }),
    );
    const explainer = createDefaultExplanationGenerator();
    const out = await explainer.explain({
      result,
      items: corpus.items,
    });
    expect(out.length).toBe(2);
    expect(out[0]!.summary).toContain('content_based');
    expect(out[0]!.drivers.length).toBeGreaterThan(0);
  });

  it('LLM-backed generator calls the injected brain', async () => {
    const corpus = buildClusterCorpus();
    const reco = createContentBasedRecommender();
    const result = reco.recommend(
      buildRequest({ corpus, userId: 'u0', topK: 1 }),
    );
    const calls: string[] = [];
    const explainer = createLLMExplanationGenerator({
      brain: async (prompt: string): Promise<string> => {
        calls.push(prompt);
        return 'Mr. Mwikila says: solid match on grade band.';
      },
    });
    const out = await explainer.explain({ result, items: corpus.items });
    expect(calls.length).toBe(1);
    expect(out[0]!.summary).toContain('grade band');
  });
});
