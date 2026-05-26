/**
 * Tavily adapter tests — fetch-stubbed.
 */

import { describe, expect, it } from 'vitest';

import {
  createTavilyAdapter,
  TAVILY_COST_CENTS,
  TAVILY_NAME,
} from '../adapters/tavily-adapter.js';
import { buildToolContext, captureLogger, createFetchStub } from './_helpers.js';

const RECENT_ISO = new Date().toISOString();
const SAMPLE_BODY = JSON.stringify({
  query: 'tanzania mining royalty',
  answer: 'Royalty is 6% on gold...',
  results: [
    {
      title: 'Tanzania Mining Royalty Rate',
      url: 'https://www.tumemadini.go.tz/royalty/notice',
      content: 'The royalty on gold is 6% of gross value...',
      raw_content:
        'The royalty on gold is 6% of gross value as defined in the 2017 Mining Act amendments. Effective 1 January 2018.',
      published_date: RECENT_ISO,
      score: 0.91,
    },
    {
      title: 'Industry overview',
      url: 'https://www.mining.com/tanzania-overview',
      content: "Tanzania remains Africa's 4th largest gold producer...",
      published_date: RECENT_ISO,
    },
  ],
});

describe('createTavilyAdapter', () => {
  it('returns ResearchArtifact[] with valid audit hash, score, citation id', async () => {
    const stub = createFetchStub();
    stub.on('api.tavily.com', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createTavilyAdapter({ apiKey: 'test-key' });

    const out = await adapter.invoke(
      { query: 'tanzania mining royalty', is_fast_moving_topic: true },
      ctx,
    );

    expect(out).toHaveLength(2);
    expect(out[0]?.tool_name).toBe(TAVILY_NAME);
    expect(out[0]?.source_kind).toBe('web');
    expect(out[0]?.source_class).toBe('tz_official'); // tumemadini.go.tz
    expect(out[0]?.quality_score).toBeGreaterThan(0.8);
    expect(out[0]?.audit_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(out[0]?.citation_id).toMatch(/^cit_/);
    expect(out[1]?.source_class).toBe('trade_press'); // mining.com
  });

  it('honors cost budget — refuses to call if budget would be exceeded', async () => {
    const stub = createFetchStub();
    stub.on('api.tavily.com', { status: 200, body: SAMPLE_BODY });
    // budget too small to cover the call
    const ctx = buildToolContext({
      fetchImpl: stub.fn,
      budget_usd_cents: 0,
    });
    const adapter = createTavilyAdapter({ apiKey: 'test-key' });

    const out = await adapter.invoke({ query: 'test' }, ctx);
    expect(out).toEqual([]);
    // No HTTP call should have been made
    expect(stub.calls).toHaveLength(0);
  });

  it('cache hit returns cached result without HTTP', async () => {
    const stub = createFetchStub();
    stub.on('api.tavily.com', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createTavilyAdapter({ apiKey: 'test-key' });

    await adapter.invoke({ query: 'gold royalty' }, ctx);
    const firstCalls = stub.calls.length;

    await adapter.invoke({ query: 'gold royalty' }, ctx);
    expect(stub.calls.length).toBe(firstCalls);
  });

  it('returns [] when TAVILY_API_KEY absent + does not throw', async () => {
    const logger = captureLogger();
    const ctx = buildToolContext({ logger });
    const adapter = createTavilyAdapter({}); // no apiKey, no env

    // clear env in case it's set in the test runner
    const prev = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      const out = await adapter.invoke({ query: 'x' }, ctx);
      expect(out).toEqual([]);
      expect(logger.warns.some((w) => w.includes('TAVILY_API_KEY missing'))).toBe(true);
    } finally {
      if (prev) process.env.TAVILY_API_KEY = prev;
    }
  });

  it('handles fetch failure gracefully and releases the budget reservation', async () => {
    const stub = createFetchStub();
    stub.on('api.tavily.com', new Error('econnreset'));
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createTavilyAdapter({ apiKey: 'test-key' });

    const out = await adapter.invoke({ query: 'test' }, ctx);
    expect(out).toEqual([]);
    const spent = await ctx.cost_tracker.spent();
    expect(spent).toBe(0); // released after failure
  });

  it('reports cost_per_call_usd_cents', () => {
    const adapter = createTavilyAdapter({ apiKey: 'k' });
    expect(adapter.cost_per_call_usd_cents).toBe(TAVILY_COST_CENTS);
    expect(adapter.authority_tier).toBe(0);
  });
});
