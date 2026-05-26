/**
 * Exa adapter tests — fetch-stubbed.
 */

import { describe, expect, it } from 'vitest';

import {
  createExaAdapter,
  EXA_COST_CENTS,
  EXA_NAME,
} from '../adapters/exa-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

const RECENT_ISO = new Date().toISOString();
const SAMPLE_BODY = JSON.stringify({
  results: [
    {
      id: 'paper-1',
      url: 'https://arxiv.org/abs/2401.12345',
      title: 'Hybrid mining and the Tanzanian shield',
      text: 'We investigate the metallurgy of the Lake Victoria greenstone belt and...',
      highlights: ['Tanzanian shield ore grades exceed 4 g/t'],
      publishedDate: RECENT_ISO,
      score: 0.83,
    },
    {
      id: 'page-2',
      url: 'https://www.tumemadini.go.tz/applications/list',
      title: 'Mining Commission application list',
      text: 'List of pending mining licence applications as of Q1 2026.',
      publishedDate: RECENT_ISO,
    },
  ],
});

describe('createExaAdapter', () => {
  it('returns ResearchArtifact[] with semantic scores', async () => {
    const stub = createFetchStub();
    stub.on('api.exa.ai', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createExaAdapter({ apiKey: 'test-key' });

    const out = await adapter.invoke(
      { query: 'tanzania mining metallurgy', is_fast_moving_topic: false },
      ctx,
    );

    expect(out).toHaveLength(2);
    expect(out[0]?.tool_name).toBe(EXA_NAME);
    expect(out[0]?.source_class).toBe('academic'); // arxiv.org
    expect(out[1]?.source_class).toBe('tz_official'); // tumemadini.go.tz
    expect(out[0]?.quality_score).toBeGreaterThan(0.8);
  });

  it('refuses to call when budget exceeded', async () => {
    const stub = createFetchStub();
    stub.on('api.exa.ai', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn, budget_usd_cents: 1 });
    const adapter = createExaAdapter({ apiKey: 'test-key' });

    const out = await adapter.invoke({ query: 'test' }, ctx);
    expect(out).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('cache hit avoids HTTP call', async () => {
    const stub = createFetchStub();
    stub.on('api.exa.ai', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createExaAdapter({ apiKey: 'test-key' });

    await adapter.invoke({ query: 'q1' }, ctx);
    const after1 = stub.calls.length;
    await adapter.invoke({ query: 'q1' }, ctx);
    expect(stub.calls.length).toBe(after1);
  });

  it('returns [] without throwing when key missing', async () => {
    const prev = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    try {
      const adapter = createExaAdapter({});
      const ctx = buildToolContext();
      const out = await adapter.invoke({ query: 'x' }, ctx);
      expect(out).toEqual([]);
    } finally {
      if (prev) process.env.EXA_API_KEY = prev;
    }
  });

  it('reports cost meta', () => {
    const adapter = createExaAdapter({ apiKey: 'k' });
    expect(adapter.cost_per_call_usd_cents).toBe(EXA_COST_CENTS);
    expect(adapter.authority_tier).toBe(0);
  });

  it('handles HTTP error gracefully', async () => {
    const stub = createFetchStub();
    stub.on('api.exa.ai', { status: 500, body: '{"error":"oops"}' });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createExaAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ query: 'fail' }, ctx);
    expect(out).toEqual([]);
    const spent = await ctx.cost_tracker.spent();
    expect(spent).toBe(0);
  });
});
