import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseSSEFrame, streamingFetch } from '../streaming/streaming-fetch.js';

describe('parseSSEFrame', () => {
  it('parses event/id/data', () => {
    const r = parseSSEFrame('event: chunk\nid: 5\ndata: hello');
    expect(r).toEqual({ event: 'chunk', id: '5', data: 'hello' });
  });

  it('defaults event to "message" when missing', () => {
    const r = parseSSEFrame('data: hi');
    expect(r?.event).toBe('message');
  });

  it('returns null for comment-only frames (:ping)', () => {
    expect(parseSSEFrame(':ping')).toBeNull();
  });

  it('returns null for empty frames', () => {
    expect(parseSSEFrame('')).toBeNull();
  });

  it('concatenates multi-line data', () => {
    const r = parseSSEFrame('data: line1\ndata: line2');
    expect(r?.data).toBe('line1\nline2');
  });
});

describe('streamingFetch', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockResponse(body: string, status = 200): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Chunk in halves to exercise the buffered parser
        const half = Math.floor(body.length / 2);
        controller.enqueue(encoder.encode(body.slice(0, half)));
        controller.enqueue(encoder.encode(body.slice(half)));
        controller.close();
      },
    });
    return new Response(stream, {
      status,
      statusText: status === 200 ? 'OK' : 'Server Error',
    });
  }

  it('parses chunks and calls onChunk for each event', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse(
          'event: message\ndata: hello\n\nevent: message\ndata: world\n\n',
        ),
      );
    const chunks: string[] = [];
    const result = await streamingFetch('/x', {
      onChunk: (c) => chunks.push(c),
    });
    expect(chunks).toEqual(['hello', 'world']);
    expect(result).toBe('helloworld');
  });

  it('throws on non-ok status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse('err', 500));
    await expect(streamingFetch('/x')).rejects.toThrow(/500/);
  });

  it('ignores :ping comment frames', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse(':ping\n\ndata: real\n\n'));
    const chunks: string[] = [];
    await streamingFetch('/x', { onChunk: (c) => chunks.push(c) });
    expect(chunks).toEqual(['real']);
  });
});
