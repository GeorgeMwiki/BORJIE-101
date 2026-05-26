/**
 * Firecrawl adapter tests.
 */

import { describe, expect, it } from 'vitest';

import {
  createFirecrawlAdapter,
  FIRECRAWL_NAME,
} from '../adapters/firecrawl-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

const SAMPLE_BODY = JSON.stringify({
  success: true,
  data: {
    markdown: '# Tanzania gold notice\n\nThe royalty has been updated to 6%.',
    metadata: {
      title: 'Tanzania gold notice',
      sourceURL: 'https://www.tumemadini.go.tz/notices/1',
      publishedTime: '2026-01-15T00:00:00Z',
    },
  },
});

describe('createFirecrawlAdapter', () => {
  it('returns a single ResearchArtifact with markdown body', async () => {
    const stub = createFetchStub();
    stub.on('api.firecrawl.dev', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createFirecrawlAdapter({ apiKey: 'k' });

    const out = await adapter.invoke(
      { url: 'https://www.tumemadini.go.tz/notices/1' },
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.tool_name).toBe(FIRECRAWL_NAME);
    expect(out[0]?.content).toContain('royalty');
    expect(out[0]?.source_class).toBe('tz_official');
  });

  it('returns [] when FIRECRAWL_API_KEY missing', async () => {
    const prev = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    try {
      const adapter = createFirecrawlAdapter({});
      const ctx = buildToolContext();
      const out = await adapter.invoke({ url: 'https://x.com' }, ctx);
      expect(out).toEqual([]);
    } finally {
      if (prev) process.env.FIRECRAWL_API_KEY = prev;
    }
  });

  it('cache hit avoids HTTP call', async () => {
    const stub = createFetchStub();
    stub.on('api.firecrawl.dev', { status: 200, body: SAMPLE_BODY });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createFirecrawlAdapter({ apiKey: 'k' });
    await adapter.invoke({ url: 'https://x.com' }, ctx);
    const after1 = stub.calls.length;
    await adapter.invoke({ url: 'https://x.com' }, ctx);
    expect(stub.calls.length).toBe(after1);
  });

  it('handles missing data gracefully', async () => {
    const stub = createFetchStub();
    stub.on('api.firecrawl.dev', {
      status: 200,
      body: JSON.stringify({ success: false }),
    });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createFirecrawlAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ url: 'https://x.com' }, ctx);
    expect(out).toEqual([]);
  });

  it('honors cost budget', async () => {
    const ctx = buildToolContext({ budget_usd_cents: 0 });
    const adapter = createFirecrawlAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ url: 'https://x.com' }, ctx);
    expect(out).toEqual([]);
  });
});
