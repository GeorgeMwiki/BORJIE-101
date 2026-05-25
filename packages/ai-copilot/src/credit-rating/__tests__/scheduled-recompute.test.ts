import { describe, it, expect } from 'vitest';
import {
  runScheduledRecompute,
  SCHEDULED_TASK_CRON,
  SCHEDULED_TASK_NAME,
  type CreditRatingService,
  type CreditRating,
} from '../index.js';

function fakeService(
  behavior: Record<string, CreditRating[] | Error>,
): CreditRatingService {
  return {
    async computeRating() {
      throw new Error('not used in recomputeAll path');
    },
    async recomputeAll(tenantId) {
      const r = behavior[tenantId];
      if (r instanceof Error) throw r;
      return r ?? [];
    },
    async recordPromiseOutcome() {
      return {} as never;
    },
    async getHistory() {
      return [];
    },
    async getWeights() {
      return {} as never;
    },
    async setWeights() {
      return {} as never;
    },
    async optInSharing() {
      return {} as never;
    },
    async revokeSharing() {},
    async listSharing() {
      return [];
    },
  };
}

describe('scheduled-recompute', () => {
  it('exports Sun 03:00 cron', () => {
    expect(SCHEDULED_TASK_CRON).toBe('0 3 * * 0');
    expect(SCHEDULED_TASK_NAME).toBe('recompute_tenant_credit_ratings');
  });

  it('iterates tenants and sums recomputed customers', async () => {
    const svc = fakeService({
      't-1': [{} as CreditRating, {} as CreditRating],
      't-2': [{} as CreditRating],
    });
    const res = await runScheduledRecompute({
      service: svc,
      tenantEnumerator: async () => ['t-1', 't-2'],
    });
    expect(res.tenantCount).toBe(2);
    expect(res.customersRecomputed).toBe(3);
    expect(res.failures.length).toBe(0);
  });

  it('collects failures without crashing', async () => {
    const svc = fakeService({
      't-ok': [{} as CreditRating],
      't-fail': new Error('boom'),
    });
    const res = await runScheduledRecompute({
      service: svc,
      tenantEnumerator: async () => ['t-ok', 't-fail'],
    });
    expect(res.customersRecomputed).toBe(1);
    expect(res.failures.length).toBe(1);
    expect(res.failures[0].tenantId).toBe('t-fail');
  });
});
