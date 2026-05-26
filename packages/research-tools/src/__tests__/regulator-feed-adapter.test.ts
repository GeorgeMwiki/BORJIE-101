/**
 * Regulator-feed adapter — RSS/Atom parsing + adapter behaviour.
 */

import { describe, expect, it } from 'vitest';

import {
  createRegulatorFeedAdapter,
  parseFeed,
  REGULATOR_NAME,
} from '../adapters/regulator-feed-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Tumemadini circulars</title>
    <item>
      <title>Royalty notice 2026/01</title>
      <link>https://www.tumemadini.go.tz/circular/1</link>
      <description><![CDATA[Royalty on gold updated to 6.5%]]></description>
      <pubDate>2026-01-15T00:00:00Z</pubDate>
    </item>
    <item>
      <title>License application opening</title>
      <link>https://www.tumemadini.go.tz/notice/2</link>
      <description>New PML window now open</description>
      <pubDate>2026-02-01T00:00:00Z</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>NEMC gazette item</title>
    <link href="https://www.nemc.or.tz/gazette/1" />
    <summary>Environmental approval published</summary>
    <published>2026-01-10T00:00:00Z</published>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses RSS 2.0 items', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('Royalty notice 2026/01');
    expect(items[0]?.link).toBe('https://www.tumemadini.go.tz/circular/1');
    expect(items[0]?.description).toContain('Royalty on gold');
  });

  it('parses Atom entries', () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('NEMC gazette item');
    expect(items[0]?.link).toBe('https://www.nemc.or.tz/gazette/1');
  });

  it('returns [] on malformed XML', () => {
    expect(parseFeed('not xml at all')).toEqual([]);
    expect(parseFeed('')).toEqual([]);
  });
});

describe('createRegulatorFeedAdapter', () => {
  it('classifies every item as tz_official + emits ResearchArtifact', async () => {
    const stub = createFetchStub();
    stub.on('tumemadini.go.tz', { status: 200, body: RSS });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createRegulatorFeedAdapter();

    const out = await adapter.invoke({ regulator: 'tumemadini' }, ctx);

    expect(out).toHaveLength(2);
    expect(out[0]?.tool_name).toBe(REGULATOR_NAME);
    expect(out[0]?.source_kind).toBe('feed');
    expect(out[0]?.source_class).toBe('tz_official');
    expect(out[0]?.quality_score).toBeGreaterThan(0.6);
  });

  it('honors the since filter', async () => {
    const stub = createFetchStub();
    stub.on('tumemadini.go.tz', { status: 200, body: RSS });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createRegulatorFeedAdapter();

    const out = await adapter.invoke(
      { regulator: 'tumemadini', since: '2026-01-20T00:00:00Z' },
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('License application opening');
  });

  it('respects the limit', async () => {
    const stub = createFetchStub();
    stub.on('tumemadini.go.tz', { status: 200, body: RSS });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createRegulatorFeedAdapter();

    const out = await adapter.invoke({ regulator: 'tumemadini', limit: 1 }, ctx);
    expect(out).toHaveLength(1);
  });

  it('returns [] on fetch failure without throwing', async () => {
    const stub = createFetchStub();
    stub.on('tumemadini.go.tz', new Error('econnrefused'));
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createRegulatorFeedAdapter();
    const out = await adapter.invoke({ regulator: 'tumemadini' }, ctx);
    expect(out).toEqual([]);
  });

  it('supports each regulator kind via override URLs', async () => {
    const stub = createFetchStub();
    stub.on('mockhost.example', { status: 200, body: ATOM });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createRegulatorFeedAdapter({
      feedUrls: { nemc: 'https://mockhost.example/feed' },
    });
    const out = await adapter.invoke({ regulator: 'nemc' }, ctx);
    expect(out).toHaveLength(1);
  });
});
