import { describe, expect, it } from 'vitest';
import {
  buyerMineMatch,
  regulatorFilingMatch,
  supplierMineMatch,
  trainingCourseWorkerMatch,
  workerSiteMatch,
} from '../domain/mining-reco.js';
import { buildClusterCorpus, buildRequest } from '../__fixtures__/synthetic.js';

describe('Mr. Mwikila mining-domain wrappers', () => {
  it('buyerMineMatch emits ensemble + MMR-diverse top-K', () => {
    const corpus = buildClusterCorpus();
    const req = buildRequest({
      corpus,
      userId: 'u0',
      target: 'buyer_mine',
      topK: 3,
      seed: 42,
    });
    const r = buyerMineMatch(req, { now: () => 1700000000000 });
    expect(r.algorithm).toBe('ensemble:content_based,matrix_factorization');
    expect(r.topK.length).toBeLessThanOrEqual(3);
    expect(r.auditHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.tenantId).toBe(corpus.tenantId);
  });

  it('workerSiteMatch uses item-item CF', () => {
    const corpus = buildClusterCorpus();
    const req = buildRequest({
      corpus,
      userId: 'u0',
      target: 'worker_site',
      topK: 2,
    });
    const r = workerSiteMatch(req);
    expect(r.algorithm).toBe('item_item_cf');
  });

  it('regulatorFilingMatch uses content-based', () => {
    const corpus = buildClusterCorpus();
    const req = buildRequest({
      corpus,
      userId: 'u0',
      target: 'regulator_filing',
      topK: 2,
    });
    const r = regulatorFilingMatch(req);
    expect(r.algorithm).toBe('content_based');
  });

  it('supplierMineMatch uses matrix factorization', () => {
    const corpus = buildClusterCorpus();
    const req = buildRequest({
      corpus,
      userId: 'u0',
      target: 'supplier_mine',
      topK: 2,
      seed: 11,
    });
    const r = supplierMineMatch(req);
    expect(r.algorithm).toBe('matrix_factorization');
  });

  it('trainingCourseWorkerMatch routes through the cold-start router', () => {
    const corpus = buildClusterCorpus();
    const req = buildRequest({
      corpus,
      userId: 'u4',
      target: 'course_worker',
      topK: 2,
    });
    const r = trainingCourseWorkerMatch(req);
    expect(r.algorithm).toBe('coldstart_router');
  });

  it('every wrapper rejects a wrong target', () => {
    const corpus = buildClusterCorpus();
    const req = buildRequest({
      corpus,
      userId: 'u0',
      target: 'worker_site',
      topK: 2,
    });
    expect(() => buyerMineMatch(req)).toThrow(/expected target buyer_mine/);
  });

  it('every wrapper rejects empty tenantId', () => {
    const corpus = buildClusterCorpus();
    const req = {
      ...buildRequest({
        corpus,
        userId: 'u0',
        target: 'buyer_mine',
        topK: 2,
      }),
      tenantId: '',
    };
    expect(() => buyerMineMatch(req)).toThrow(/empty tenantId/);
  });
});
