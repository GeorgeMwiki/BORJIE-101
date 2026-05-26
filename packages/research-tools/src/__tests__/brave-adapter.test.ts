/**
 * Brave adapter tests — fetch-stubbed.
 */

import { describe, expect, it } from 'vitest';

import {
  createBraveAdapter,
  BRAVE_COST_CENTS,
  BRAVE_NAME,
} from '../adapters/brave-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

const SAMPLE_BODY = JSON.stringify({
  web: {
    results: [
      {
        title: 'BBC: Tanzania local content rules',
        url: 'https://www.bbc.com/news/tanzania-local-content',
        description: 'Tanzania has tightened local-content rules for mining...',
      },
      {
        title: 'Some random blog',
        url: 'https://example.com/random',
        description: 'A blog post about mining',
      },
    ],
  },
});

describe('createBraveAdapter', () => {
  it('returns ResearchArtifact[] classified by domain', async () => {
    const stub = createFetchStub();
    stub.on('api.search.brave.com', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createBraveAdapter({ apiKey: 'k' });

    const out = await adapter.invoke({ query: 'tanzania mining' }, ctx);

    expect(out).toHaveLength(2);
    expect(out[0]?.tool_name).toBe(BRAVE_NAME);
    expect(out[0]?.source_class).toBe('established_news'); // bbc.com
    expect(out[1]?.source_class).toBe('generic_blog'); // example.com
    expect(out[1]?.quality_score).toBeLessThan(0.4);
  });

  it('honors cost budget', async () => {
    const stub = createFetchStub();
    stub.on('api.search.brave.com', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn, budget_usd_cents: 0 });
    const adapter = createBraveAdapter({ apiKey: 'k' });

    const out = await adapter.invoke({ query: 'test' }, ctx);
    expect(out).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('returns [] when BRAVE_SEARCH_API_KEY missing', async () => {
    const prev = process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    try {
      const adapter = createBraveAdapter({});
      const ctx = buildToolContext();
      const out = await adapter.invoke({ query: 'q' }, ctx);
      expect(out).toEqual([]);
    } finally {
      if (prev) process.env.BRAVE_SEARCH_API_KEY = prev;
    }
  });

  it('cache hit avoids HTTP call', async () => {
    const stub = createFetchStub();
    stub.on('api.search.brave.com', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createBraveAdapter({ apiKey: 'k' });

    await adapter.invoke({ query: 'q1' }, ctx);
    const after1 = stub.calls.length;
    await adapter.invoke({ query: 'q1' }, ctx);
    expect(stub.calls.length).toBe(after1);
  });

  it('reports cost meta', () => {
    const adapter = createBraveAdapter({ apiKey: 'k' });
    expect(adapter.cost_per_call_usd_cents).toBe(BRAVE_COST_CENTS);
    expect(adapter.authority_tier).toBe(0);
  });
});
