/**
 * PDF-extract + image-vision adapter tests.
 */

import { describe, expect, it } from 'vitest';

import {
  createImageVisionAdapter,
  IMAGE_VISION_NAME,
} from '../adapters/image-vision-adapter.js';
import {
  createPdfExtractAdapter,
  PDF_EXTRACT_NAME,
} from '../adapters/pdf-extract-adapter.js';
import { buildToolContext, createFetchStub } from './_helpers.js';

describe('createPdfExtractAdapter', () => {
  it('returns a single PDF artifact via injected extractor', async () => {
    const adapter = createPdfExtractAdapter({
      extractor: {
        async extract(input) {
          return {
            text: 'Mining licence PML-001 holder report',
            title: 'PML-001 report',
            source_uri: input.source,
            published_at: new Date().toISOString(),
          };
        },
      },
    });
    const ctx = buildToolContext();
    const out = await adapter.invoke(
      { source: 'https://x.com/file.pdf', source_kind: 'url' },
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.tool_name).toBe(PDF_EXTRACT_NAME);
    expect(out[0]?.source_kind).toBe('pdf');
    expect(out[0]?.content).toContain('PML-001');
  });

  it('returns [] when extractor throws', async () => {
    const adapter = createPdfExtractAdapter({
      extractor: {
        async extract() {
          throw new Error('OCR failed');
        },
      },
    });
    const ctx = buildToolContext();
    const out = await adapter.invoke({ source: 'x' }, ctx);
    expect(out).toEqual([]);
    expect(await ctx.cost_tracker.spent()).toBe(0);
  });

  it('honors cost budget', async () => {
    const adapter = createPdfExtractAdapter({
      extractor: {
        async extract() {
          return { text: 'never called' };
        },
      },
    });
    const ctx = buildToolContext({ budget_usd_cents: 0 });
    const out = await adapter.invoke({ source: 'x' }, ctx);
    expect(out).toEqual([]);
  });

  it('cache hit avoids extractor call', async () => {
    let calls = 0;
    const adapter = createPdfExtractAdapter({
      extractor: {
        async extract() {
          calls++;
          return { text: 'doc' };
        },
      },
    });
    const ctx = buildToolContext();
    await adapter.invoke({ source: 'x' }, ctx);
    await adapter.invoke({ source: 'x' }, ctx);
    expect(calls).toBe(1);
  });
});

describe('createImageVisionAdapter', () => {
  const body = JSON.stringify({
    content: [
      { type: 'text', text: 'Chart shows copper rising 12% YoY.' },
    ],
  });

  it('returns a vision artifact when key + response valid', async () => {
    const stub = createFetchStub();
    stub.on('api.anthropic.com', { status: 200, body });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createImageVisionAdapter({ apiKey: 'k' });
    const out = await adapter.invoke(
      { image_source: 'https://x.com/chart.png' },
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.tool_name).toBe(IMAGE_VISION_NAME);
    expect(out[0]?.source_kind).toBe('image');
    expect(out[0]?.content).toContain('copper');
  });

  it('returns [] without ANTHROPIC_API_KEY', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const adapter = createImageVisionAdapter({});
      const ctx = buildToolContext();
      const out = await adapter.invoke({ image_source: 'x' }, ctx);
      expect(out).toEqual([]);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('handles base64 image source', async () => {
    const stub = createFetchStub();
    stub.on('api.anthropic.com', { status: 200, body });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createImageVisionAdapter({ apiKey: 'k' });
    const out = await adapter.invoke(
      {
        image_source: 'data:image/png;base64,iVBORw0KGgo=',
        image_kind: 'base64',
        media_type: 'image/png',
      },
      ctx,
    );
    expect(out).toHaveLength(1);
  });

  it('returns [] on empty response content', async () => {
    const stub = createFetchStub();
    stub.on('api.anthropic.com', {
      status: 200,
      body: JSON.stringify({ content: [] }),
    });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createImageVisionAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ image_source: 'x' }, ctx);
    expect(out).toEqual([]);
    expect(await ctx.cost_tracker.spent()).toBe(0);
  });

  it('handles HTTP error gracefully', async () => {
    const stub = createFetchStub();
    stub.on('api.anthropic.com', { status: 429, body: '{"error":"rate"}' });
    const ctx = buildToolContext({ fetchImpl: stub.fn });
    const adapter = createImageVisionAdapter({ apiKey: 'k' });
    const out = await adapter.invoke({ image_source: 'x' }, ctx);
    expect(out).toEqual([]);
    expect(await ctx.cost_tracker.spent()).toBe(0);
  });
});
