import { describe, expect, it } from 'vitest';
import { formatSSEFrame, streamSSE, SSE_HEADERS } from '../streaming/stream-sse.js';

const DECODER = new TextDecoder();

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out += DECODER.decode(value);
  }
  return out;
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe('formatSSEFrame', () => {
  it('produces the canonical event/data/blank-line shape', () => {
    expect(formatSSEFrame('message', 'hello', '1')).toBe(
      'event: message\nid: 1\ndata: hello\n\n',
    );
  });

  it('splits multi-line data into multiple data: lines (spec requirement)', () => {
    expect(formatSSEFrame('message', 'a\nb')).toContain('data: a\ndata: b');
  });

  it('omits id line when id missing', () => {
    expect(formatSSEFrame('m', 'd')).toBe('event: m\ndata: d\n\n');
  });
});

describe('streamSSE', () => {
  it('emits one frame per source item', async () => {
    const stream = streamSSE({
      source: fromArray([1, 2, 3]),
      mapper: (n) => JSON.stringify({ n }),
      keepAliveMs: 0,
    });
    const out = await collect(stream);
    expect(out).toContain('data: {"n":1}');
    expect(out).toContain('data: {"n":2}');
    expect(out).toContain('data: {"n":3}');
    // event: message is default
    expect(out.match(/event: message/g)?.length).toBe(3);
  });

  it('skips items where mapper returns null', async () => {
    const stream = streamSSE({
      source: fromArray([1, 2, 3]),
      mapper: (n) => (n === 2 ? null : String(n)),
      keepAliveMs: 0,
    });
    const out = await collect(stream);
    expect(out).toContain('data: 1');
    expect(out).not.toContain('data: 2');
    expect(out).toContain('data: 3');
  });

  it('emits error frame on iterator throw', async () => {
    const stream = streamSSE({
      source: (async function* () {
        yield 1;
        throw new Error('upstream gone');
      })(),
      mapper: (n) => String(n),
      keepAliveMs: 0,
    });
    const out = await collect(stream);
    expect(out).toContain('data: 1');
    expect(out).toContain('event: error');
    expect(out).toContain('upstream gone');
  });

  it('uses custom eventName', async () => {
    const stream = streamSSE({
      source: fromArray([1]),
      mapper: (n) => String(n),
      eventName: 'chunk',
      keepAliveMs: 0,
    });
    const out = await collect(stream);
    expect(out).toContain('event: chunk');
  });

  it('SSE_HEADERS includes no-cache and text/event-stream', () => {
    expect(SSE_HEADERS['Content-Type']).toContain('text/event-stream');
    expect(SSE_HEADERS['Cache-Control']).toContain('no-cache');
  });
});
