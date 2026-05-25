import { describe, expect, it, vi } from 'vitest';
import { createMarkerAdapter } from '../marker-adapter.js';

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('createMarkerAdapter', () => {
  it('parses per-page markdown into ParsedDocument and strips markdown by default', async () => {
    const fetcher = fakeFetch({
      pages: [
        { page: 1, markdown: '# Title\n\nBody **bold** [link](https://x)' },
        { page: 2, markdown: '## Section\n\nMore text' },
      ],
      metadata: { languages: ['English'] },
    });
    const adapter = createMarkerAdapter({
      endpoint: 'http://localhost:9999/marker',
      fetcher,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
    });
    expect(doc.producedBy).toBe('marker');
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0]!.blocks[0]!.text).not.toContain('#');
    expect(doc.pages[0]!.blocks[0]!.text).not.toContain('**');
    expect(doc.pages[0]!.language).toBe('en');
  });

  it('preserves markdown when configured to', async () => {
    const fetcher = fakeFetch({
      pages: [{ page: 1, markdown: '# Title\n\nBody **bold**' }],
      metadata: { languages: ['Swahili'] },
    });
    const adapter = createMarkerAdapter({
      endpoint: 'http://localhost:9999/marker',
      fetcher,
      preserveMarkdown: true,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
    });
    expect(doc.pages[0]!.blocks[0]!.text).toContain('#');
    expect(doc.pages[0]!.language).toBe('sw');
  });

  it('falls back to doc-wide markdown when per-page is absent', async () => {
    const fetcher = fakeFetch({
      markdown: 'Just a single chunk of content',
      metadata: { languages: ['French'] },
    });
    const adapter = createMarkerAdapter({
      endpoint: 'http://localhost:9999/marker',
      fetcher,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
    });
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.blocks[0]!.text).toBe('Just a single chunk of content');
    expect(doc.pages[0]!.language).toBe('fr');
  });

  it('returns empty doc on HTTP error', async () => {
    const fetcher = fakeFetch({ error: 'bad' }, 502);
    const adapter = createMarkerAdapter({
      endpoint: 'http://localhost:9999/marker',
      fetcher,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
    });
    expect(doc.producedBy).toBe('marker-http-502');
  });
});
