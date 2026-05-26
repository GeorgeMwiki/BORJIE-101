/**
 * Tests for the graph-rag-community-summaries sleep pass.
 */

import { describe, expect, it } from 'vitest';
import {
  createGraphRAGCommunitySummariesPass,
  createInMemoryGraphRAGAdapter,
  type GraphRAGCommunityAdapter,
} from '../graph-rag-community-summaries.js';

const now = () => new Date('2026-05-26T03:30:00.000Z');
const signal = new AbortController().signal;

describe('graph-rag-community-summaries pass', () => {
  it('returns a zero-tenant result when no tenants are listed', async () => {
    const adapter = createInMemoryGraphRAGAdapter([]);
    const pass = createGraphRAGCommunitySummariesPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(0);
    expect(result.itemsEmitted).toBe(0);
    expect(result.errored).toBe(false);
    expect(result.notes).toMatch(/tenants=0/);
  });

  it('aggregates communitiesSummarised across multiple tenants', async () => {
    const adapter = createInMemoryGraphRAGAdapter([
      {
        tenantId: 't1',
        communitiesConsidered: 5,
        communitiesSummarised: 2,
        communitiesSkipped: 3,
      },
      {
        tenantId: 't2',
        communitiesConsidered: 4,
        communitiesSummarised: 1,
        communitiesSkipped: 3,
      },
    ]);
    const pass = createGraphRAGCommunitySummariesPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(9);
    expect(result.itemsEmitted).toBe(3);
    expect(adapter.callsFor('t1')).toBe(1);
    expect(adapter.callsFor('t2')).toBe(1);
    expect(result.notes).toMatch(/summarised=3/);
    expect(result.notes).toMatch(/skipped=6/);
  });

  it('reports zero summarised when every community signature is unchanged', async () => {
    const adapter = createInMemoryGraphRAGAdapter([
      {
        tenantId: 't1',
        communitiesConsidered: 7,
        communitiesSummarised: 0,
        communitiesSkipped: 7,
      },
    ]);
    const pass = createGraphRAGCommunitySummariesPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(0);
    expect(result.itemsProcessed).toBe(7);
  });

  it('continues on per-tenant adapter failures (partial progress)', async () => {
    let calls = 0;
    const flaky: GraphRAGCommunityAdapter = {
      async listTenants() {
        return ['t1', 't2', 't3'];
      },
      async runForTenant({ tenantId }) {
        calls += 1;
        if (tenantId === 't2') {
          throw new Error('boom');
        }
        return {
          tenantId,
          communitiesConsidered: 2,
          communitiesSummarised: 1,
          communitiesSkipped: 1,
        };
      },
    };
    const pass = createGraphRAGCommunitySummariesPass(flaky);
    const result = await pass.run({ abortSignal: signal, now });
    expect(calls).toBe(3);
    expect(result.itemsEmitted).toBe(2); // t1 + t3
    expect(result.errored).toBe(false);
  });

  it('honours the abort signal', async () => {
    const ac = new AbortController();
    const adapter: GraphRAGCommunityAdapter = {
      async listTenants() {
        return ['t1', 't2'];
      },
      async runForTenant({ tenantId }) {
        ac.abort();
        return {
          tenantId,
          communitiesConsidered: 1,
          communitiesSummarised: 1,
          communitiesSkipped: 0,
        };
      },
    };
    const pass = createGraphRAGCommunitySummariesPass(adapter);
    const result = await pass.run({ abortSignal: ac.signal, now });
    expect(result.aborted).toBe(true);
  });

  it('declares a daily schedule at 03:30 with 18h min-interval', () => {
    const adapter = createInMemoryGraphRAGAdapter([]);
    const pass = createGraphRAGCommunitySummariesPass(adapter);
    expect(pass.schedule.cadence).toEqual({ kind: 'daily', hour: 3, minute: 30 });
    expect(pass.schedule.minIntervalMinutes).toBe(60 * 18);
    expect(pass.schedule.priority).toBe(3);
  });

  it('inMemoryAdapter returns a zero-plan for unknown tenants', async () => {
    const adapter = createInMemoryGraphRAGAdapter([
      {
        tenantId: 't1',
        communitiesConsidered: 1,
        communitiesSummarised: 0,
        communitiesSkipped: 1,
      },
    ]);
    // Force a request for an unseeded tenant via the public method:
    const plan = await adapter.runForTenant({
      tenantId: 't-unknown',
      abortSignal: signal,
    });
    expect(plan.communitiesConsidered).toBe(0);
    expect(plan.communitiesSummarised).toBe(0);
  });
});
