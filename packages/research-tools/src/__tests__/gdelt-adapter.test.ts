/**
 * GDELT adapter tests.
 */

import { describe, expect, it } from 'vitest';

import { createGdeltAdapter, GDELT_NAME } from '../adapters/gdelt-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

const SAMPLE_BODY = JSON.stringify({
  articles: [
    {
      url: 'https://www.bbc.com/news/tanzania-gold',
      title: 'Tanzania gold production rises',
      seendate: new Date().toISOString(),
      domain: 'bbc.com',
      language: 'English',
      sourcecountry: 'United Kingdom',
    },
    {
      url: 'https://www.reuters.com/article/tanzania-mining',
      title: 'Reuters: Tanzania mining update',
      seendate: new Date().toISOString(),
    },
  ],
});

describe('createGdeltAdapter', () => {
  it('returns articles as feed artifacts', async () => {
    const stub = createFetchStub();
    stub.on('gdeltproject.org', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createGdeltAdapter();
    const out = await adapter.invoke({ query: 'tanzania mining' }, ctx);
    expect(out).toHaveLength(2);
    expect(out[0]?.tool_name).toBe(GDELT_NAME);
    expect(out[0]?.source_kind).toBe('feed');
    expect(out[0]?.source_class).toBe('established_news'); // bbc.com
    expect(out[1]?.source_class).toBe('tier1_market'); // reuters.com
  });

  it('handles fetch failure', async () => {
    const stub = createFetchStub();
    stub.on('gdeltproject.org', { status: 500, body: 'oops' });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createGdeltAdapter();
    const out = await adapter.invoke({ query: 'x' }, ctx);
    expect(out).toEqual([]);
  });

  it('cache hit avoids HTTP', async () => {
    const stub = createFetchStub();
    stub.on('gdeltproject.org', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createGdeltAdapter();
    await adapter.invoke({ query: 'q' }, ctx);
    const after1 = stub.calls.length;
    await adapter.invoke({ query: 'q' }, ctx);
    expect(stub.calls.length).toBe(after1);
  });

  it('reports cost = 0', () => {
    const adapter = createGdeltAdapter();
    expect(adapter.cost_per_call_usd_cents).toBe(0);
  });
});
