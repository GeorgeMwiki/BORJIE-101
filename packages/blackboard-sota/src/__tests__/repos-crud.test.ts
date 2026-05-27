/**
 * Repository CRUD smoke tests for the 5 in-memory adapters.
 *
 * Wave BLACKBOARD-CORE. One quick test per repo verifying create +
 * read + uniqueness semantics.
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemoryRegionsRepository,
  createInMemoryKnowledgeSourcesRepository,
  createInMemoryPostsRepository,
  createInMemoryCrossReferencesRepository,
  createInMemorySummariesRepository,
} from '../index.js';

describe('regions repo — CRUD + tenant isolation', () => {
  it('open + get round-trips and listByTenant filters by status', async () => {
    const repo = createInMemoryRegionsRepository();
    const region = await repo.open({
      tenantId: 't1',
      id: 'r1',
      regionKind: 'incident-investigation',
    });
    const fetched = await repo.get('t1', 'r1');
    expect(fetched?.id).toBe(region.id);
    expect(await repo.get('t2', 'r1')).toBeNull();
    await repo.open({
      tenantId: 't1',
      id: 'r2',
      regionKind: 'incident-investigation',
    });
    await repo.transition('t1', 'r2', 'closed');
    const open = await repo.listByTenant('t1', { status: 'open' });
    const closed = await repo.listByTenant('t1', { status: 'closed' });
    expect(open).toHaveLength(1);
    expect(closed).toHaveLength(1);
  });
});

describe('cross-references repo — UNIQUE quadruple', () => {
  it('idempotent record returns the same row', async () => {
    const repo = createInMemoryCrossReferencesRepository();
    const a = await repo.record({
      tenantId: 't1',
      srcPostId: 'p-1',
      dstPostId: 'p-2',
      refKind: 'cites',
      confidence: 0.95,
    });
    const b = await repo.record({
      tenantId: 't1',
      srcPostId: 'p-1',
      dstPostId: 'p-2',
      refKind: 'cites',
      confidence: 0.95,
    });
    expect(a.id).toBe(b.id);
  });

  it('different ref_kind on same (src, dst) is allowed', async () => {
    const repo = createInMemoryCrossReferencesRepository();
    const a = await repo.record({
      tenantId: 't1',
      srcPostId: 'p-1',
      dstPostId: 'p-2',
      refKind: 'cites',
      confidence: 0.95,
    });
    const b = await repo.record({
      tenantId: 't1',
      srcPostId: 'p-1',
      dstPostId: 'p-2',
      refKind: 'contradicts',
      confidence: 0.7,
    });
    expect(a.id).not.toBe(b.id);
  });

  it('listForPost returns refs in both directions', async () => {
    const repo = createInMemoryCrossReferencesRepository();
    await repo.record({
      tenantId: 't1',
      srcPostId: 'p-1',
      dstPostId: 'p-2',
      refKind: 'cites',
      confidence: 0.95,
    });
    await repo.record({
      tenantId: 't1',
      srcPostId: 'p-3',
      dstPostId: 'p-1',
      refKind: 'answers',
      confidence: 0.95,
    });
    const refs = await repo.listForPost('t1', 'p-1');
    expect(refs).toHaveLength(2);
  });
});

describe('summaries repo — latestForRegion', () => {
  it('returns the most recent summary of the given kind', async () => {
    const repo = createInMemorySummariesRepository();
    await repo.append({
      tenantId: 't1',
      regionId: 'r1',
      summaryKind: 'rolling',
      summaryText: 'first',
      tokenCount: 100,
      coversFrom: new Date(1),
      coversTo: new Date(2),
    });
    await new Promise((r) => setTimeout(r, 5));
    await repo.append({
      tenantId: 't1',
      regionId: 'r1',
      summaryKind: 'rolling',
      summaryText: 'second',
      tokenCount: 200,
      coversFrom: new Date(3),
      coversTo: new Date(4),
    });
    const latest = await repo.latestForRegion('t1', 'r1', 'rolling');
    expect(latest?.summaryText).toBe('second');
  });

  it('returns null when no summary of that kind exists', async () => {
    const repo = createInMemorySummariesRepository();
    const result = await repo.latestForRegion('t1', 'r1', 'final');
    expect(result).toBeNull();
  });
});

describe('posts repo — listByRegion sorting and limit', () => {
  it('respects ascending / descending + limit', async () => {
    let t = 1000;
    const repo = createInMemoryPostsRepository({
      now: () => new Date(t++),
    });
    for (let i = 0; i < 5; i += 1) {
      await repo.append({
        tenantId: 't1',
        regionId: 'r1',
        ksId: 'ks',
        content: `post #${i}`,
      });
    }
    const asc = await repo.listByRegion('t1', 'r1', { ascending: true });
    expect(asc[0]?.content).toBe('post #0');
    const desc = await repo.listByRegion('t1', 'r1', { ascending: false });
    expect(desc[0]?.content).toBe('post #4');
    const limited = await repo.listByRegion('t1', 'r1', { limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe('ks repo — idempotent register on (tenant, kind, name)', () => {
  it('returns the existing row when re-registering with the same triple', async () => {
    const repo = createInMemoryKnowledgeSourcesRepository();
    const a = await repo.register({
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'mining-planner',
      priority: 0.5,
    });
    const b = await repo.register({
      tenantId: 't1',
      ksKind: 'junior',
      ksName: 'mining-planner',
      priority: 0.99,
    });
    expect(a.id).toBe(b.id);
  });
});
