/**
 * LME + Kitco commodity adapter tests.
 */

import { describe, expect, it } from 'vitest';

import { createKitcoAdapter, KITCO_NAME } from '../adapters/kitco-adapter.js';
import { createLmeAdapter, LME_NAME } from '../adapters/lme-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

describe('createLmeAdapter', () => {
  it('returns a feed artifact with tier1_market class', async () => {
    const body = JSON.stringify({
      commodity: 'copper',
      price: 9_500,
      currency: 'USD',
      asOf: new Date().toISOString(),
    });
    const stub = createFetchStub();
    stub.on('api.lme.com', { status: 200, body });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createLmeAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ commodity: 'copper' }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.tool_name).toBe(LME_NAME);
    expect(out[0]?.source_class).toBe('tier1_market');
    expect(out[0]?.content).toContain('9500');
  });

  it('returns [] when LME_API_KEY missing', async () => {
    const prev = process.env.LME_API_KEY;
    delete process.env.LME_API_KEY;
    try {
      const adapter = createLmeAdapter({});
      const ctx = buildToolContext();
      const out = await adapter.invoke({ commodity: 'gold' }, ctx);
      expect(out).toEqual([]);
    } finally {
      if (prev) process.env.LME_API_KEY = prev;
    }
  });

  it('honors cost budget', async () => {
    const ctx = buildToolContext({ budget_usd_cents: 0 });
    const adapter = createLmeAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ commodity: 'gold' }, ctx);
    expect(out).toEqual([]);
  });
});

describe('createKitcoAdapter', () => {
  it('returns a feed artifact for spot gold', async () => {
    const body = JSON.stringify({
      metal: 'gold',
      spot: 2_350,
      currency: 'USD',
      asOf: new Date().toISOString(),
    });
    const stub = createFetchStub();
    stub.on('kitco.com', { status: 200, body });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createKitcoAdapter();
    const out = await adapter.invoke({ metal: 'gold' }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.tool_name).toBe(KITCO_NAME);
    expect(out[0]?.source_class).toBe('tier1_market');
  });

  it('cache hit avoids HTTP', async () => {
    const body = JSON.stringify({
      metal: 'gold',
      spot: 2_350,
      currency: 'USD',
      asOf: new Date().toISOString(),
    });
    const stub = createFetchStub();
    stub.on('kitco.com', { status: 200, body });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createKitcoAdapter();
    await adapter.invoke({ metal: 'gold' }, ctx);
    const after1 = stub.calls.length;
    await adapter.invoke({ metal: 'gold' }, ctx);
    expect(stub.calls.length).toBe(after1);
  });

  it('costs 0 cents per call', () => {
    const adapter = createKitcoAdapter();
    expect(adapter.cost_per_call_usd_cents).toBe(0);
  });
});
