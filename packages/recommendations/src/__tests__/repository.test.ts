import { describe, expect, it } from 'vitest';
import { createInMemoryRecommendationRepository } from '../repositories/recommendation-repository.js';
import { sealResult } from '../util/seal.js';
import type { RecommendationResult } from '../types.js';

function makeResult(tenantId: string): RecommendationResult {
  return sealResult({
    tenantId,
    target: 'buyer_mine',
    algorithm: 'popularity',
    userId: 'u0',
    topK: [{ itemId: 'm0', score: 3, reason: 'popularity' }],
    candidates: ['m0', 'm1'],
    servedAt: 1_700_000_000_000,
  });
}

describe('RecommendationRepository — in-memory', () => {
  it('saves a run, retrieves it via findRuns, and chains audit hashes', async () => {
    let n = 0;
    const repo = createInMemoryRecommendationRepository({
      newId: (): string => `id-${(n += 1)}`,
      now: (): number => 1_700_000_000_000,
    });
    const r1 = await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    const r2 = await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    expect(r1.id).toBe('id-1');
    expect(r2.id).toBe('id-2');
    expect(r2.prevHash).toBe(r1.auditHash);
    const all = await repo.findRuns({ tenantId: 'tenant-a' });
    expect(all.length).toBe(2);
  });

  it('records feedback and chains its hash off the run hash', async () => {
    const repo = createInMemoryRecommendationRepository();
    const run = await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    const fb = await repo.recordFeedback({
      runId: run.id,
      userId: 'u0',
      itemId: 'm0',
      signal: 'click',
      value: 1,
    });
    expect(fb.runId).toBe(run.id);
    expect(fb.auditHash).toMatch(/^[0-9a-f]{64}$/);
    const list = await repo.findFeedback({
      runId: run.id,
      tenantId: 'tenant-a',
    });
    expect(list.length).toBe(1);
  });

  it('refuses to return a run across tenants', async () => {
    const repo = createInMemoryRecommendationRepository();
    await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    const seenByB = await repo.findRuns({ tenantId: 'tenant-b' });
    expect(seenByB.length).toBe(0);
  });

  it('refuses to leak feedback to a foreign tenant even given the run id', async () => {
    const repo = createInMemoryRecommendationRepository();
    const run = await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    await repo.recordFeedback({
      runId: run.id,
      userId: 'u0',
      itemId: 'm0',
      signal: 'click',
      value: 1,
    });
    const leaked = await repo.findFeedback({
      runId: run.id,
      tenantId: 'tenant-b', // wrong tenant claim
    });
    expect(leaked.length).toBe(0);
  });

  it('rejects mismatched tenant between input and result on saveRun', async () => {
    const repo = createInMemoryRecommendationRepository();
    await expect(
      repo.saveRun({
        tenantId: 'tenant-a',
        target: 'buyer_mine',
        result: makeResult('tenant-b'),
      }),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it('rejects feedback value outside [0, 5]', async () => {
    const repo = createInMemoryRecommendationRepository();
    const run = await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    await expect(
      repo.recordFeedback({
        runId: run.id,
        userId: 'u0',
        itemId: 'm0',
        signal: 'rate',
        value: 7,
      }),
    ).rejects.toThrow(/value out of range/);
  });

  it('filters findRuns by target', async () => {
    const repo = createInMemoryRecommendationRepository();
    await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
      result: makeResult('tenant-a'),
    });
    const workerResult: RecommendationResult = {
      ...makeResult('tenant-a'),
      target: 'worker_site',
    };
    await repo.saveRun({
      tenantId: 'tenant-a',
      target: 'worker_site',
      result: workerResult,
    });
    const onlyBuyer = await repo.findRuns({
      tenantId: 'tenant-a',
      target: 'buyer_mine',
    });
    expect(onlyBuyer.length).toBe(1);
    expect(onlyBuyer[0]?.target).toBe('buyer_mine');
  });
});
