import { describe, expect, it, vi } from 'vitest';
import { createDoclingAdapter } from '../docling-adapter.js';

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('createDoclingAdapter', () => {
  it('parses pages, blocks, and tables from a Docling JSON response', async () => {
    const fetcher = fakeFetch({
      pages: [
        {
          page_number: 1,
          width: 612,
          height: 792,
          language: 'eng',
          blocks: [
            {
              id: 'b-1',
              text: 'Invoice #123',
              bbox: { x: 0.05, y: 0.05, width: 0.4, height: 0.04 },
              role: 'heading',
              confidence: 0.97,
            },
          ],
          tables: [
            {
              id: 't-1',
              rows: [
                ['Item', 'Qty', 'Price'],
                ['Pipe', '4', '500'],
              ],
              bbox: { x: 0.05, y: 0.3, width: 0.9, height: 0.2 },
              confidence: 0.92,
            },
          ],
        },
      ],
    });
    const adapter = createDoclingAdapter({
      endpoint: 'http://localhost:7777/parse',
      apiKey: 'tok',
      fetcher,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'application/pdf',
      lang: ['en'],
      layout: 'standard',
    });
    expect(doc.producedBy).toBe('docling');
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.blocks[0]!.role).toBe('heading');
    expect(doc.pages[0]!.tables).toHaveLength(1);
    expect(doc.pages[0]!.tables[0]!.rows).toHaveLength(2);
  });

  it('falls back to empty doc on HTTP error', async () => {
    const fetcher = fakeFetch({ error: 'server' }, 500);
    const adapter = createDoclingAdapter({
      endpoint: 'http://localhost:7777/parse',
      fetcher,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
    });
    expect(doc.producedBy).toBe('docling-http-500');
  });

  it('honors a custom adapter id', async () => {
    const fetcher = fakeFetch({ pages: [] });
    const adapter = createDoclingAdapter({
      endpoint: 'http://localhost:7777/parse',
      fetcher,
      id: 'docling-invoices',
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
    });
    expect(doc.producedBy).toBe('docling-invoices');
  });
});
