import { describe, expect, it } from 'vitest';
import {
  createLlamaParseParser,
  createParserRegistry,
  createUnstructuredParser,
} from '../parsers/index.js';

describe('parsers / document adapters', () => {
  it('Unstructured.io adapter throws fast without an api key', () => {
    expect(() => createUnstructuredParser({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('LlamaParse adapter throws fast without an api key', () => {
    expect(() => createLlamaParseParser({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('Unstructured.io adapter calls the configured fetchFn with the api key header', async () => {
    let captured: { url: string; headers: Headers } | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      captured = {
        url: String(input),
        headers: new Headers(init?.headers),
      };
      return new Response(
        JSON.stringify([
          { type: 'Title', text: 'doc title', metadata: { page_number: 1 } },
          { type: 'NarrativeText', text: 'body', metadata: { page_number: 1 } },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const parser = createUnstructuredParser({ apiKey: 'sk-test', fetchFn: fakeFetch });
    const rows = await parser.parse(new Uint8Array([1, 2, 3]), 'application/pdf');
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain('/general/v0/general');
    expect(captured!.headers.get('unstructured-api-key')).toBe('sk-test');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.['type']).toBe('Title');
  });

  it('parser registry resolves by id and returns null when missing', () => {
    const parser = createUnstructuredParser({
      apiKey: 'sk-test',
      fetchFn: async () => new Response('[]', { status: 200 }),
    });
    const reg = createParserRegistry([parser]);
    expect(reg.resolve('unstructured')).toBe(parser);
    expect(reg.resolve('nope')).toBeNull();
  });

  it('Unstructured.io adapter surfaces HTTP errors clearly', async () => {
    const fakeFetch: typeof fetch = async () => new Response('boom', { status: 500 });
    const parser = createUnstructuredParser({ apiKey: 'sk-test', fetchFn: fakeFetch });
    await expect(parser.parse(new Uint8Array([1]), 'application/pdf')).rejects.toThrow(/500/);
  });
});
