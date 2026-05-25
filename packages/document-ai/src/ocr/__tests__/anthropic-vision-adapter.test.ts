import { describe, expect, it, vi } from 'vitest';
import { createAnthropicVisionAdapter } from '../anthropic-vision-adapter.js';

function fakeFetch(ok: boolean, body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      statusText: ok ? 'OK' : 'ERR',
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('createAnthropicVisionAdapter', () => {
  it('parses a Vision response into a ParsedDocument with one block', async () => {
    const fetcher = fakeFetch(true, {
      content: [{ type: 'text', text: 'RECEIPT\nTotal: 12,500 TZS' }],
      usage: { input_tokens: 200, output_tokens: 30 },
    });
    const adapter = createAnthropicVisionAdapter({
      apiKey: 'test-key',
      fetcher,
      model: 'claude-opus-4-7',
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/jpeg',
      lang: ['sw'],
      layout: 'full',
    });
    expect(doc.producedBy).toBe('anthropic-vision');
    expect(doc.pages[0]!.blocks).toHaveLength(1);
    expect(doc.pages[0]!.blocks[0]!.text).toContain('RECEIPT');
    expect(doc.pages[0]!.language).toBe('sw');
  });

  it('falls back to empty doc on non-OK status', async () => {
    const fetcher = fakeFetch(false, { error: 'rate limit' }, 429);
    const adapter = createAnthropicVisionAdapter({
      apiKey: 'test-key',
      fetcher,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'image/png',
    });
    expect(doc.producedBy).toBe('anthropic-vision-http-429');
    expect(doc.pages[0]!.blocks).toHaveLength(0);
  });

  it('sends image base64 + correct headers', async () => {
    const fetcher = fakeFetch(true, { content: [{ type: 'text', text: 'X' }] });
    const adapter = createAnthropicVisionAdapter({
      apiKey: 'sk-test-xyz',
      fetcher,
    });
    await adapter.recognize({
      bytes: new Uint8Array([255, 216, 255]),
      mime: 'image/jpeg',
      lang: ['en'],
    });
    const call = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toContain('anthropic.com');
    expect(call[1].headers['x-api-key']).toBe('sk-test-xyz');
    const body = JSON.parse(call[1].body);
    expect(body.messages[0].content[0].source.type).toBe('base64');
  });
});
