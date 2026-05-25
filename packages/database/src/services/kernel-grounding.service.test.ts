/**
 * Unit tests for createKernelGroundingProvider — focuses on the
 * keyword-routing and visibility-scoping policy. The DatabaseClient is
 * stubbed so we never run real Drizzle queries — we just count how
 * many SELECT chains the service launches and what shape the results
 * take.
 */
import { describe, it, expect } from 'vitest';
import { createKernelGroundingProvider } from './kernel-grounding.service.js';
import type { DatabaseClient } from '../client.js';

interface StubOptions {
  /** Result returned for every SELECT (one [row]). */
  readonly row?: Record<string, unknown>;
  /** Throw on every SELECT (per-fact failure path). */
  readonly throwOnSelect?: boolean;
}

function makeStubDb(opts: StubOptions = {}): {
  client: DatabaseClient;
  selectCount: () => number;
} {
  let count = 0;
  const row = opts.row ?? { count: 1, total: 10, occupied: 5 };
  const stubResult = opts.throwOnSelect
    ? Promise.reject(new Error('select boom'))
    : Promise.resolve([row]);
  // pre-handle to avoid unhandled-rejection warnings
  if (opts.throwOnSelect) stubResult.catch(() => undefined);

  const client = {
    select: () => {
      count += 1;
      return {
        from: () => ({
          where: () =>
            opts.throwOnSelect
              ? Promise.reject(new Error('select boom'))
              : Promise.resolve([row]),
          // For sub-queries, return same chain
          innerJoin: () => ({
            where: () => Promise.resolve([row]),
          }),
        }),
      };
    },
  } as unknown as DatabaseClient;

  return { client, selectCount: () => count };
}

describe('createKernelGroundingProvider — guard rails', () => {
  it('returns [] when role is sovereign', async () => {
    const stub = makeStubDb();
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'sovereign',
    });
    const out = await provider.fetch({
      userMessage: 'occupancy?',
      tier: 'tenant',
      limit: 10,
    });
    expect(out).toEqual([]);
    expect(stub.selectCount()).toBe(0);
  });

  it('returns [] when tenantId is null', async () => {
    const stub = makeStubDb();
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: null,
    });
    const out = await provider.fetch({
      userMessage: 'occupancy please',
      tier: 'tenant',
      limit: 10,
    });
    expect(out).toEqual([]);
    expect(stub.selectCount()).toBe(0);
  });

  it('returns [] when message has no keyword triggers', async () => {
    const stub = makeStubDb();
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
    });
    const out = await provider.fetch({
      userMessage: 'tell me a joke',
      tier: 'tenant',
      limit: 10,
    });
    expect(out).toEqual([]);
    expect(stub.selectCount()).toBe(0);
  });
});

describe('createKernelGroundingProvider — keyword routing', () => {
  it('triggers occupancy fact for "vacancy" keyword', async () => {
    const stub = makeStubDb({ row: { total: 4, occupied: 1 } });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    const out = await provider.fetch({
      userMessage: 'what is the vacancy?',
      tier: 'org',
      limit: 10,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('gf:occupancy');
    expect(out[0]?.unit).toBe('pct');
    expect(out[0]?.value).toBe(0.25); // 1/4
  });

  it('triggers active-leases for "lease" keyword', async () => {
    const stub = makeStubDb({ row: { count: 3 } });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    const out = await provider.fetch({
      userMessage: 'how many active leases?',
      tier: 'org',
      limit: 10,
    });
    const ids = out.map((f) => f.id);
    expect(ids).toContain('gf:active-leases');
  });

  it('triggers open-work-orders for "maintenance" keyword', async () => {
    const stub = makeStubDb({ row: { count: 7 } });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    const out = await provider.fetch({
      userMessage: 'maintenance backlog?',
      tier: 'org',
      limit: 10,
    });
    expect(out.find((f) => f.id === 'gf:open-work-orders')?.value).toBe(7);
  });

  it('triggers lease-expiring for "renew" keyword', async () => {
    const stub = makeStubDb({ row: { count: 2 } });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    const out = await provider.fetch({
      userMessage: 'how many leases up for renewal?',
      tier: 'org',
      limit: 10,
    });
    expect(out.find((f) => f.id === 'gf:lease-expiring')?.value).toBe(2);
  });

  it('caps results at the supplied limit', async () => {
    const stub = makeStubDb({ row: { count: 1 } });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    const out = await provider.fetch({
      // Multiple kinds match this message
      userMessage: 'occupancy + lease + maintenance + renewal',
      tier: 'org',
      limit: 2,
    });
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('returns null occupancy when total is zero (skipped)', async () => {
    const stub = makeStubDb({ row: { total: 0, occupied: 0 } });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    const out = await provider.fetch({
      userMessage: 'occupancy please',
      tier: 'org',
      limit: 10,
    });
    expect(out).toHaveLength(0);
  });
});

describe('createKernelGroundingProvider — error tolerance', () => {
  it('swallows per-fact errors so the main path never breaks', async () => {
    const stub = makeStubDb({ throwOnSelect: true });
    const provider = createKernelGroundingProvider(stub.client, {
      tenantId: 't',
      role: 'org-admin',
    });
    // Should not throw — failed runners return null and are filtered.
    const out = await provider.fetch({
      userMessage: 'lease + maintenance',
      tier: 'org',
      limit: 10,
    });
    expect(out).toEqual([]);
  });
});
